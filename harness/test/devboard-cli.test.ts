import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  lessonChecklist,
  lintDecisionFiles,
  parseLintProblems,
  parseTaskIds,
  parseToolNames,
  requireToolNames,
  runDevboard,
} from "../src/devboard-cli.ts";

test("devboard の出力（タスク ID・ツール名・決定記録の問題）を、形を確かめて読む", () => {
  assert.deepEqual(parseTaskIds('{"summary":{},"tasks":[{"id":"T-001"},{"id":"T-002"}]}'), ["T-001", "T-002"]);
  assert.deepEqual(parseToolNames('["get_overview","create_task"]'), ["get_overview", "create_task"]);
  assert.deepEqual(
    parseLintProblems('[{"check":"invalid-decision","file":"docs/decisions/0001-x.md","message":"直す"}]'),
    [{ check: "invalid-decision", file: "docs/decisions/0001-x.md", message: "直す" }],
  );
  assert.throws(() => parseToolNames('{"not":"an array"}'));
  assert.throws(() => parseLintProblems('[{"check":1}]'));
});

test("devboard コマンドで、決定記録の形式とツール名を得る", () => {
  const good = "# 0001. はじめ\n\n- 状態: 採用\n- 日付: 2026-11-16\n\n## 背景\n\na\n\n## 決定\n\nb\n\n## 影響\n\nc\n";
  assert.deepEqual(lintDecisionFiles([{ file: "docs/decisions/0001-first.md", text: good }], process.cwd()), []);
  const problems = lintDecisionFiles(
    [{ file: "docs/decisions/0001-first.md", text: "# 0001. はじめ\n" }],
    process.cwd(),
  );
  assert.ok(problems.length > 0 && problems.every((p) => p.check === "invalid-decision"));
  assert.deepEqual(lintDecisionFiles([], process.cwd()), [], "決定記録が無ければ、devboard を呼ばない");
  assert.ok(requireToolNames(process.cwd()).includes("get_overview"));
});

test("差分に引き金が当たった教訓だけを devboard checklist で得て、devboard が無ければ止めずにそう返す", () => {
  const dir = mkdtempSync(join(tmpdir(), "autodev-checklist-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const saved = { ...process.env };
  after(() => {
    process.env = saved;
  });
  process.env.DEVBOARD_ROOT = dir;
  process.env.DEVBOARD_DB = join(dir, "board.sqlite");
  const added = runDevboard(
    [
      "apply",
      JSON.stringify([
        {
          op: "add_lesson",
          args: {
            title: "readline は Unicode の改行でも分ける",
            problem: "p",
            fix: "f",
            trigger: { words: ["readline"], check: "LF だけで分ける" },
          },
        },
      ]),
    ],
    dir,
  );
  assert.ok(added.ok, added.ok ? "" : added.message);

  const diff = (line: string) => `diff --git a/src/a.ts b/src/a.ts\n@@ -0,0 +1 @@\n+${line}\n`;
  assert.match(lessonChecklist(diff("readline.createInterface()"), dir), /L-001 readline は Unicode.*\n {2}確かめる: LF だけで分ける/);
  assert.equal(lessonChecklist(diff("const x = 1;"), dir), "");

  process.env.PATH = "";
  assert.match(lessonChecklist(diff("readline"), dir), /出せなかった/);
});
