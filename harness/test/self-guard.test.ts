import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSelfGuards } from "../src/checks/self-guard.ts";
import { memoryRepo } from "../src/repo.ts";

const checksOf = (now: Record<string, string>, base: Record<string, string>) =>
  checkSelfGuards(memoryRepo(now, base)).map((p) => p.check);

const WORKFLOW = ".github/workflows/check.yml";
const workflow = (steps: string) =>
  `name: check\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm install --frozen-lockfile\n${steps}`;
const gateStep = "      # ゲートを回す\n      - run: pnpm check\n";

test("CI からゲートを回す行を消す・ファイルごと消す・失敗を通す形にするのを見つける", () => {
  const base = { [WORKFLOW]: workflow(gateStep) };
  assert.deepEqual(checksOf({ [WORKFLOW]: workflow("") }, base), ["loosened-ci"], "行を消す");
  assert.deepEqual(checksOf({}, base), ["loosened-ci"], "ファイルごと消す");
  assert.deepEqual(
    checksOf({ [WORKFLOW]: workflow("      # - run: pnpm check\n") }, base),
    ["loosened-ci"],
    "コメントにする",
  );
  assert.deepEqual(
    checksOf({ [WORKFLOW]: workflow(`${gateStep}        continue-on-error: true\n`) }, base),
    ["loosened-ci"],
    "失敗しても通す",
  );
});

test("CI のゲートの行を残したまま、ほかの段を変える・足すのは通す", () => {
  const base = { [WORKFLOW]: workflow(gateStep) };
  assert.deepEqual(checksOf({ [WORKFLOW]: workflow(`      - run: pnpm build\n${gateStep}`) }, base), []);
  assert.deepEqual(checksOf({ [WORKFLOW]: workflow(gateStep.replace("ゲートを回す", "ゲート")) }, base), []);
  assert.deepEqual(checksOf({ [WORKFLOW]: workflow(gateStep) }, {}), [], "基点に無かった CI を足す");
});

const HOOK = ".githooks/pre-commit";
const hook = (body: string) => `#!/bin/sh\n# コミットの前にゲートを通す\n${body}`;

test("フックから autodev hook の呼び出しを消すのを見つけ、前後を変えるのは通す", () => {
  const base = { [HOOK]: hook("exec autodev hook pre-commit\n") };
  assert.deepEqual(checksOf({ [HOOK]: hook("exit 0\n") }, base), ["neutered-hook"]);
  assert.deepEqual(checksOf({ [HOOK]: hook("# exec autodev hook pre-commit\n") }, base), ["neutered-hook"]);
  assert.deepEqual(checksOf({}, base), ["neutered-hook"], "フックを消す");
  assert.deepEqual(
    checksOf({ [HOOK]: hook("command -v autodev >/dev/null || exit 1\nexec autodev hook pre-commit\n") }, base),
    [],
  );
});

test("hiddenPaths から基点にあったパスを外すのを見つけ、足すのは通す", () => {
  const config = (paths: string[]) => ({ ".devboard.json": JSON.stringify({ hiddenPaths: paths }) });
  const base = config([".autodev/eval/heldout/"]);
  assert.deepEqual(checksOf(config([]), base), ["unhidden-path"]);
  assert.deepEqual(checksOf({}, base), ["unhidden-path"], "設定ごと消す");
  assert.deepEqual(checksOf(config([".autodev/eval/heldout/", "secret/"]), base), []);
});
