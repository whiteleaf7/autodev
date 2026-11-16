import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lintDecisionFiles,
  parseLintProblems,
  parseTaskIds,
  parseToolNames,
  requireToolNames,
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
