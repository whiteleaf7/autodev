import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppArgs } from "../src/app-options.ts";
import { judge, type Observed, PROOF_FILE, PROOF_TEXT, scenario } from "../src/app-scenario.ts";

const passing: Observed = {
  tools: [{ name: "Write", status: "done" }],
  assistant: ["できました"],
  turn: { text: "ターンが終わった・4.2 秒", isError: false },
  alerts: [],
  transcript: "",
};

test("Write が完了し、返事とターンの終わりが画面に出て、ファイルが書かれていれば通す", () => {
  assert.deepEqual(judge(passing, `${PROOF_TEXT}\n`), []);
});

test("画面に出ていないものと、書かれていないファイルを、それぞれ理由にする", () => {
  const broken: Observed = {
    ...passing,
    tools: [{ name: "Write", status: "denied" }],
    assistant: [],
    turn: { text: "エラーで止まった", isError: true },
    alerts: ["つながらない"],
  };
  const problems = judge(broken, null);
  assert.equal(problems.length, 5);
  assert.match(problems[0] ?? "", /完了した Write が無い/);
  assert.match(problems[1] ?? "", /返事が無い/);
  assert.match(problems[2] ?? "", /エラーで終わった: エラーで止まった/);
  assert.match(problems[3] ?? "", /エラーが出ている: つながらない/);
  assert.match(problems[4] ?? "", new RegExp(`${PROOF_FILE} が作業ディレクトリに無い`));

  assert.deepEqual(judge({ ...passing, turn: null }, "other"), [
    "画面にターンの終わりが無い",
    `${PROOF_FILE} の中身が「${PROOF_TEXT}」でない: "other"`,
  ]);
});

test("筋書きは作業ディレクトリを入れ、承認の前と終わりの画面を撮る", () => {
  const steps = scenario("/tmp/work");
  assert.ok(steps.some((step) => step.act?.includes('"/tmp/work"')));
  assert.deepEqual(
    steps.flatMap((step) => (step.snapshot ? [step.snapshot] : [])),
    ["permission.png", "turn-end.png"],
  );
});

test("既定はビルドし直して軽いモデルで動かし、知らない引数は使い方を添えて断る", () => {
  assert.deepEqual(parseAppArgs([]), { build: true, model: "haiku", out: undefined });
  assert.deepEqual(parseAppArgs(["--skip-build", "--model", "sonnet", "--out", ".dev/verify/x"]), {
    build: false,
    model: "sonnet",
    out: ".dev/verify/x",
  });
  assert.throws(() => parseAppArgs(["--fast"]), /使い方: pnpm verify:app/);
});
