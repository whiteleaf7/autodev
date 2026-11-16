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
