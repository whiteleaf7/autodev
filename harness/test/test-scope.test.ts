import assert from "node:assert/strict";
import { test } from "node:test";
import { testArgs } from "../src/test-scope.ts";

const scoped = { AUTODEV_TEST_SCOPE: "changed" };

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
