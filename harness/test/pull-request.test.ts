import { test } from "node:test";
import assert from "node:assert/strict";
import { pushesToMain } from "../src/commit.ts";
import { ciVerdict, pullRequestBody, titleProblem } from "../src/pull-request.ts";

test("PR の本文は、コミットの件名の一覧と、重ねない Task: の行にする", () => {
  const body = pullRequestBody([
    { subject: "feat: add x", body: "詳しい説明\n\nTask: T-055\n" },
    { subject: "docs: describe x", body: "Task: T-055" },
    { subject: "chore: tidy", body: "" },
  ]);
  assert.equal(body, "## Summary\n\n- feat: add x\n- docs: describe x\n- chore: tidy\n\nTask: T-055\n");
  assert.equal(pullRequestBody([{ subject: "fix: y", body: "" }]), "## Summary\n\n- fix: y\n");
});

test("CI は、落ちたものがあれば失敗、未登録か走っているものがあれば待ち、ほかは成功", () => {
  assert.deepEqual(ciVerdict([]), { state: "pending" }, "push した直後はまだ登録されていない");
  assert.deepEqual(ciVerdict([{ name: "check", bucket: "pending" }]), { state: "pending" });
  assert.deepEqual(
    ciVerdict([
      { name: "check", bucket: "pending" },
      { name: "lint", bucket: "fail" },
    ]),
    { state: "fail", failed: ["lint"] },
  );
  assert.deepEqual(ciVerdict([{ name: "check", bucket: "cancel" }]), { state: "fail", failed: ["check"] });
  assert.deepEqual(
    ciVerdict([
      { name: "check", bucket: "pass" },
      { name: "optional", bucket: "skipping" },
    ]),
    { state: "pass" },
  );
});

test("main への push だけを見つける", () => {
  const line = (remote: string) => `refs/heads/feat/x 1111111 ${remote} 0000000`;
  assert.equal(pushesToMain(line("refs/heads/feat/x")), false);
  assert.equal(pushesToMain(`${line("refs/heads/feat/x")}\n${line("refs/heads/main")}\n`), true);
  assert.equal(pushesToMain("(delete) 0000000 refs/heads/main 1111111"), true, "main の削除も止める");
  assert.equal(pushesToMain(line("refs/heads/main-backup")), false);
  assert.equal(pushesToMain(""), false);
});

test("新しく PR を作るときだけ、タイトルを求める", () => {
  assert.equal(titleProblem("[T-001] 一覧を並べ替える", false), null);
  assert.match(titleProblem(undefined, false) ?? "", /--title/);
  assert.equal(titleProblem(undefined, true), null, "使い回す PR は、いまのタイトルのまま");
  assert.match(titleProblem("  ", true) ?? "", /空/);
});
