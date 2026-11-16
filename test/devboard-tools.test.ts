import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDevboardTools, TOOLS_FILE } from "../src/checks/devboard-tools.ts";
import { memoryRepo } from "../src/repo.ts";

const repoWith = (files: Record<string, string>) => memoryRepo(files);

test("固定した一覧が、いまの devboard の MCP ツールと同じなら通す", () => {
  const repo = repoWith({ [TOOLS_FILE]: `["get_overview","create_task"]` });
  assert.deepEqual(checkDevboardTools(repo, ["create_task", "get_overview"]), []);
});

test("増えた・消えたツールを、直し方と一緒に見つける", () => {
  const repo = repoWith({ [TOOLS_FILE]: `["get_overview","old_tool"]` });
  const [problem, ...rest] = checkDevboardTools(repo, ["get_overview", "new_tool"]);
  assert.equal(rest.length, 0);
  assert.equal(problem?.check, "stale-devboard-tools");
  assert.match(problem?.message ?? "", /\+new_tool/);
  assert.match(problem?.message ?? "", /-old_tool/);
  assert.match(problem?.message ?? "", /devboard tools/);
});

test("devboard が無い環境（CI など）では、一覧があるだけで通す", () => {
  assert.deepEqual(checkDevboardTools(repoWith({ [TOOLS_FILE]: `["get_overview"]` }), null), []);
});

test("一覧のファイルが無いリポジトリは見ない。あって壊れていれば止める", () => {
  assert.deepEqual(checkDevboardTools(repoWith({}), ["get_overview"]), []);
  assert.deepEqual(
    checkDevboardTools(repoWith({ [TOOLS_FILE]: `{"not":"an array"}` }), ["get_overview"]).map((p) => p.check),
    ["stale-devboard-tools"],
  );
});
