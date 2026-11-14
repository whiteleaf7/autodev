import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppArgs } from "../src/app-options.ts";
import { judge, type Observed, PROOF_FILE, PROOF_TEXT, prompt, scenario } from "../src/app-scenario.ts";

const passing: Observed = {
  tools: [{ name: "Write", status: "done" }],
  assistant: ["Done."],
  turn: { text: "Turn finished · 4.2s", isError: false },
  alerts: [],
  transcript: "",
};

test("Write が完了し、返事とターンの終わりが画面に出て、ファイルが書かれていれば通す", () => {
  assert.deepEqual(judge(passing, `${PROOF_TEXT}\n`), []);
  const withOtherTools = { ...passing, tools: [{ name: "Read", status: "done" }, ...passing.tools] };
  assert.deepEqual(judge(withOtherTools, PROOF_TEXT), [], "ほかのツールが並んでいても、完了した Write があれば通す");
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
  const steps = scenario("/tmp/work", null);
  assert.ok(steps.some((step) => step.act?.includes('"/tmp/work"')));
  assert.deepEqual(
    steps.flatMap((step) => (step.snapshot ? [step.snapshot] : [])),
    ["permission.png", "turn-end.png"],
  );
  assert.doesNotMatch(prompt(null), /link/);
});

test("リンクを渡すと、返事にそのリンクを入れさせ、ターンの後でそれを押す", () => {
  const link = "http://127.0.0.1:4321/nagaya-verify-link/abc";
  assert.ok(prompt(link).includes(`[verification link](${link})`));
  const steps = scenario("/tmp/work", link);
  const afterTurn = steps.slice(steps.findIndex((step) => step.snapshot === "turn-end.png") + 1);
  assert.equal(afterTurn.length, 2);
  assert.ok(afterTurn.every((step) => step.until?.includes(link)));
  assert.ok(afterTurn[1]?.act?.includes(".click()"));
  assert.equal(afterTurn[1]?.snapshot, "link-clicked.png");
});

test("既定はビルドし直して軽いモデルで動かし、知らない引数は使い方を添えて断る", () => {
  assert.deepEqual(parseAppArgs([]), { build: true, model: "haiku", out: undefined, openLink: false });
  assert.deepEqual(parseAppArgs(["--skip-build", "--model", "sonnet", "--out", ".dev/verify/x", "--open-link"]), {
    build: false,
    model: "sonnet",
    out: ".dev/verify/x",
    openLink: true,
  });
  assert.throws(() => parseAppArgs(["--fast"]), /使い方: pnpm verify:app/);
});
