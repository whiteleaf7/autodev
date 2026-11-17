import assert from "node:assert/strict";
import { test } from "node:test";
import { testArgs } from "../src/test-scope.ts";

const scoped = { AUTODEV_TEST_SCOPE: "changed" };
const pullRequest = { ...scoped, AUTODEV_TEST_BASE: "HEAD^1" };

test("評価の複製で、ルートの test が全パッケージを回す形なら、触ったパッケージと依存先に絞る", () => {
  assert.deepEqual(testArgs(scoped, "pnpm -r test", true), ["-r", "--filter", "...[HEAD]", "test"]);
});

test("指定が無い・git の履歴が無い・ルートの test が別の形なら、絞らずにそのまま回す", () => {
  assert.deepEqual(testArgs({}, "pnpm -r test", true), ["test"]);
  assert.deepEqual(testArgs({ AUTODEV_TEST_SCOPE: "all" }, "pnpm -r test", true), ["test"]);
  assert.deepEqual(testArgs(scoped, "pnpm -r test", false), ["test"]);
  assert.deepEqual(testArgs(scoped, "node --test test/*.test.ts", true), ["test"]);
  assert.deepEqual(testArgs(scoped, undefined, true), ["test"]);
});

test("基点を渡すと、その基点からの差分が届くパッケージに絞り、ルートのパッケージは外す", () => {
  const changed = ["apps/web/src/main.tsx", "docs/harness.md", "README.md"];
  assert.deepEqual(testArgs(pullRequest, "pnpm -r test", true, changed), [
    "-r",
    "--filter",
    "...[HEAD^1]",
    "--filter",
    "!{.}",
    "test",
  ]);
});

test("ルートのファイルか CI の定義が変わっていれば、どのパッケージにも効きうるので、絞らない", () => {
  for (const file of ["pnpm-lock.yaml", "package.json", ".oxlintrc.json", ".github/workflows/check.yml"])
    assert.deepEqual(testArgs(pullRequest, "pnpm -r test", true, ["apps/web/src/main.tsx", file]), ["test"], file);
});

test("基点からの差分を取れなかったら、絞らない", () => {
  assert.deepEqual(testArgs(pullRequest, "pnpm -r test", true, null), ["test"]);
});
