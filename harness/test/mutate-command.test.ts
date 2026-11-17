import assert from "node:assert/strict";
import { test } from "node:test";
import { directCommand, testFilesOf } from "../src/mutate-command.ts";

const scripts = { typecheck: "tsc --noEmit", test: "node --import autodev/verify/register.js --test --test-timeout=120000 test/*.test.ts" };

test("pnpm を介さず、型チェック、届くテスト、残りのテストの順に回し、同じテストを 2 度回さない", () => {
  const command = directCommand(scripts, ["test/a.test.ts"], ["test/a.test.ts", "test/b.test.ts"])!;
  assert.match(command, /tsc --noEmit && node --import autodev\/verify\/register\.js --test --test-timeout=120000 test\/a\.test\.ts && node .* test\/b\.test\.ts$/);
  assert.doesNotMatch(command, /pnpm/);
  assert.equal(command.match(/test\/a\.test\.ts/g)?.length, 1);
});

test("届くテストが無ければ全部を 1 度、全部が届くなら残りは回さない。パッケージのフラグは保つ", () => {
  const all = ["test/a.test.ts", "test/b.test.ts"];
  assert.match(directCommand(scripts, [], all)!, /--test-timeout=120000 test\/a\.test\.ts test\/b\.test\.ts$/);
  const full = directCommand(scripts, all, all)!;
  assert.equal(full.match(/--test /g)?.length, 1);
});

test("スクリプトが単純な形でなければ null（これまでの pnpm 経由に落とす）", () => {
  assert.equal(directCommand({ typecheck: "pnpm -r typecheck", test: scripts.test }, [], ["test/a.test.ts"]), null);
  assert.equal(directCommand({ typecheck: "tsc --noEmit && tsc -p x", test: scripts.test }, [], ["test/a.test.ts"]), null);
  assert.equal(directCommand({ typecheck: "tsc --noEmit", test: "vitest run" }, [], ["test/a.test.ts"]), null);
  assert.equal(directCommand({ typecheck: "tsc --noEmit" }, [], ["test/a.test.ts"]), null);
});

test("テストのファイルは、パッケージの test/ の直下の *.test.ts だけ（ルートのパッケージも含む）", () => {
  const files = ["tools/v/test/a.test.ts", "tools/v/test/sub/b.test.ts", "tools/v/test/c.ts", "test/r.test.ts", "tools/w/test/x.test.ts"];
  assert.deepEqual(testFilesOf(files, "tools/v"), ["test/a.test.ts"]);
  assert.deepEqual(testFilesOf(files, "."), ["test/r.test.ts"]);
});
