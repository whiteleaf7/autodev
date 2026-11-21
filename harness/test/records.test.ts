import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRecords, decisionFiles } from "../src/checks/records.ts";
import { memoryRepo } from "../src/repo.ts";

const repo = memoryRepo({
  "docs/decisions/0002-second.md": "# 0002. 二つめ\n",
  "docs/decisions/0001-first.md": "# 0001. 一つめ\n",
  "docs/decisions/README.md": "# 決定記録の説明\n",
  "docs/decisions/sub/0003-nested.md": "# 0003. 入れ子\n",
  "docs/other.md": "# 別の文書\n",
});

test("決定記録のファイルだけを、ファイル名の順に、検査の入力にする", () => {
  assert.deepEqual(
    decisionFiles(repo).map((f) => f.file),
    ["docs/decisions/0001-first.md", "docs/decisions/0002-second.md", "docs/decisions/README.md"],
    "入れ子のディレクトリと、decisions の外は対象にしない",
  );
});

test("検査の結果（devboard の返した問題）を、そのまま受け取る", () => {
  const problem = { check: "invalid-decision", file: "docs/decisions/0001-first.md", message: "直す" };
  const seen: string[][] = [];
  const result = checkRecords(repo, (files) => {
    seen.push(files.map((f) => f.file));
    return [problem];
  });
  assert.deepEqual(result, [problem]);
  assert.equal(seen.length, 1);
});

test("決定記録が 1 つも無いリポジトリは、検査に空の入力を渡す", () => {
  let received = -1;
  assert.deepEqual(
    checkRecords(memoryRepo({ "README.md": "# x\n" }), (files) => {
      received = files.length;
      return [];
    }),
    [],
  );
  assert.equal(received, 0);
});

const DECISION = "docs/decisions/0001-first.md";

test("決定記録が比べる先のどれとも同じなら devboard を呼ばず、どれかと違えば全部を渡す", () => {
  const calls: string[][] = [];
  const lint = (files: { file: string }[]) => {
    calls.push(files.map((f) => f.file));
    return [];
  };
  const now = memoryRepo({ [DECISION]: "# 0001. 一つめ\n", "src/a.ts": "export {}\n" }, { [DECISION]: "# 0001. 一つめ\n" });
  const changed = memoryRepo({ [DECISION]: "# 0001. 直した\n" }, { [DECISION]: "# 0001. 一つめ\n" });
  const added = memoryRepo({ [DECISION]: "# 0001. 一つめ\n" }, {});

  checkRecords(now, lint, [now.base]);
  assert.equal(calls.length, 0, "基点と同じ（コミットで決定記録に触れていない）");
  checkRecords(changed, lint, [changed.base]);
  checkRecords(added, lint, [added.base]);
  assert.equal(calls.length, 2, "書き換えた・足した");
  checkRecords(now, lint, [now.base, memoryRepo({})]);
  assert.equal(calls.length, 3, "land: HEAD とは同じでも、取り込み先と違う");
  checkRecords(now, lint, [null]);
  assert.equal(calls.length, 4, "比べる先が無ければ、いつも渡す");
});
