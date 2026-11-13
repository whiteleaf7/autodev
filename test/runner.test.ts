import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decisionFilesOutsideMain, checkMessage, filesToFormat } from "../src/commit.ts";
import { applyEdits } from "../src/sandbox.ts";
import { Scenario } from "../src/scenario.ts";
import { summarize, type Outcome } from "../src/score.ts";
import { scan } from "../src/source.ts";

test("コードをコメント・文字列・それ以外に分け、位置を保つ", () => {
  const text = 'const a = "x // y"; // 説明\nconst re = /["\']/g; const t = `a ${b + "c"} d`;\n/* 複数\n行 */ run();\n';
  const { code, withStrings, comments } = scan(text);
  for (const view of [code, withStrings, comments]) {
    assert.equal(view.length, text.length);
    assert.equal(view.split("\n").length, text.split("\n").length);
  }
  assert.ok(!code.includes("x // y") && !code.includes("説明") && !code.includes("複数"));
  assert.ok(withStrings.includes('"x // y"') && !withStrings.includes("説明"));
  assert.ok(comments.includes("// 説明") && comments.includes("/* 複数") && !comments.includes("const"));
  assert.ok(
    code.includes("b +") && code.includes("run();"),
    "テンプレートの ${ } の中と、正規表現の後ろはコードとして残る",
  );
});

test("シナリオの編集を当て、当てられないときは理由を返す", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nagaya-harness-test-")));
  writeFileSync(join(dir, "a.txt"), "one two two\n");
  assert.equal(applyEdits(dir, [{ file: "a.txt", find: "one", replace: "$1 & 1" }]), null);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "$1 & 1 two two\n");
  assert.match(applyEdits(dir, [{ file: "a.txt", find: "two", replace: "2" }]) ?? "", /2 回/);
  assert.match(applyEdits(dir, [{ file: "a.txt", find: "three", replace: "3" }]) ?? "", /0 回/);
  assert.equal(
    applyEdits(dir, [
      { file: "new/b.txt", write: "b" },
      { file: "a.txt", delete: true },
    ]),
    null,
  );
  assert.ok(existsSync(join(dir, "new/b.txt")) && !existsSync(join(dir, "a.txt")));
  assert.match(applyEdits(dir, [{ file: "../outside.txt", write: "x" }]) ?? "", /外/);

  const real = mkdtempSync(join(tmpdir(), "nagaya-harness-real-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(real, join(dir, "node_modules", "pkg"));
  assert.match(applyEdits(dir, [{ file: "node_modules/pkg/index.js", write: "x" }]) ?? "", /リンク/);
  assert.ok(!existsSync(join(real, "index.js")), "リンクの先（本物）には書かない");
});

test("シナリオは family と kind の組み合わせを検証する", () => {
  const base = { id: "a", class: "c", title: "t" };
  const edits = [{ file: "a", write: "x" }];
  assert.ok(Scenario.safeParse({ ...base, family: "docs", kind: "bad", edits }).success);
  assert.ok(Scenario.safeParse({ ...base, family: "recall", kind: "query", query: "q", expect: ["T-001"] }).success);
  assert.ok(!Scenario.safeParse({ ...base, family: "docs", kind: "bad" }).success, "編集が無い");
  assert.ok(!Scenario.safeParse({ ...base, family: "docs", kind: "query", query: "q", expect: ["T-001"] }).success);
  assert.ok(!Scenario.safeParse({ ...base, family: "commits", kind: "bad", edits }).success, "commit が無い");
  const board = [{ op: "create_task", args: { title: "x", status: "wip" } }];
  assert.ok(
    Scenario.safeParse({ ...base, family: "records", kind: "bad", board }).success,
    "不正な入力も、ボードに当てる例として読める",
  );
  assert.ok(
    !Scenario.safeParse({ ...base, family: "docs", kind: "bad", edits, board }).success,
    "board は records だけ",
  );
});

test("止めた数と引き出せた数を足し、誤検出は 2 点引く", () => {
  const result = (family: "docs" | "recall", kind: "bad" | "good" | "query", outcome: Outcome) => ({
    scenario: Scenario.parse(
      kind === "query"
        ? { id: "x", family, kind, class: "c", title: "t", query: "q", expect: ["T-001"] }
        : { id: "x", family, kind, class: "c", title: "t", edits: [{ file: "a", write: "x" }] },
    ),
    outcome,
    detail: "",
  });
  const summary = summarize([
    result("docs", "bad", "caught"),
    result("docs", "bad", "missed"),
    result("docs", "bad", "inapplicable"),
    result("docs", "good", "false-alarm"),
    result("docs", "good", "passed"),
    result("recall", "query", "hit"),
    result("recall", "query", "no-hit"),
  ]);
  assert.equal(summary.families.docs.points, 1 - 2);
  assert.equal(summary.score, 0);
  assert.equal(summary.max, 5);
});

test("コミットメッセージの決まりを確かめる", () => {
  const ok = (message: string) => checkMessage(message, { existingTasks: new Set(["T-001", "T-002"]) });
  assert.deepEqual(ok("feat: add recall tool"), []);
  assert.deepEqual(ok("fix(devboard)!: reject unknown hosts\n\nTask: T-001, T-002"), []);
  assert.deepEqual(ok('Revert "feat: add recall tool"'), []);
  assert.equal(ok("update docs").length, 1);
  assert.equal(ok("feature: add tool").length, 1);
  assert.equal(ok("docs:").length, 1);
  assert.match(ok("docs: 調査メモを追加")[0] ?? "", /英語/);
  assert.match(ok("docs: add note\n\nTask: T-777")[0] ?? "", /T-777/);
});

test("作業用の worktree では、決定記録をコミットさせない", () => {
  const staged = ["tools/a.ts", "dev/harness/history.jsonl", "docs/decisions/0001-a.md", "docs/harness.md"];
  assert.deepEqual(decisionFilesOutsideMain(staged, false), [], "main の worktree では止めない");
  const problems = decisionFilesOutsideMain(staged, true);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /docs\/decisions\/0001-a\.md.*main/);
});

test("整形するのは、すべてステージしたファイルだけ", () => {
  const { format, skipped } = filesToFormat(["tools/a.ts", "tools/b.ts", "tools/c.json"], ["tools/b.ts", "docs/x.md"]);
  assert.deepEqual(format, ["tools/a.ts", "tools/c.json"]);
  assert.deepEqual(skipped, ["tools/b.ts"]);
});
