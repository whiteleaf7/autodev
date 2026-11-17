import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_CONFIG_FILE, gateModes, splitByMode } from "../src/check-modes.ts";
import { memoryRepo, type Problem } from "../src/repo.ts";

const config = (checks: Record<string, string>) => ({ [GATE_CONFIG_FILE]: JSON.stringify({ checks }) });
const twice = <T>(files: T): [T, T] => [files, files];
const problem = (check: string): Problem => ({ check, file: "a.ts", message: "m" });

test("設定の無い検査は enforce で止め、observe は止めずに分け、off は捨てる", () => {
  const modes = gateModes(memoryRepo(...twice(config({ "missing-path": "observe", "package-manager": "off" }))));
  assert.deepEqual(modes.problems, []);
  const split = splitByMode(
    [problem("skipped-test"), problem("missing-path"), problem("package-manager")],
    modes.modeOf,
  );
  assert.deepEqual(
    split.blocking.map((p) => p.check),
    ["skipped-test"],
  );
  assert.deepEqual(
    split.observed.map((p) => p.check),
    ["missing-path"],
  );
});

test("基点より mode を下げると止め、上げるのは通す", () => {
  const checksOf = (now: Record<string, string>, base: Record<string, string>) =>
    gateModes(memoryRepo(now, base)).problems.map((p) => p.check);
  assert.deepEqual(checksOf(config({ "missing-path": "observe" }), {}), ["loosened-gate-mode"], "enforce を observe に");
  assert.deepEqual(
    checksOf(config({ "missing-path": "off" }), config({ "missing-path": "observe" })),
    ["loosened-gate-mode"],
    "observe を off に",
  );
  assert.deepEqual(checksOf({}, config({ "missing-path": "observe" })), [], "設定を消して enforce に戻すのは上げる側");
  assert.deepEqual(checksOf(config({ "missing-path": "enforce" }), config({ "missing-path": "off" })), []);
  assert.deepEqual(checksOf(config({ "missing-path": "observe" }), config({ "missing-path": "observe" })), []);
});

test("既定が observe の検査は設定が無ければ observe で、enforce に上げた設定を消すのは下げる変更として止める", () => {
  const defaults = { "new-check": "observe" } as const;
  assert.equal(gateModes(memoryRepo({}), defaults).modeOf("new-check"), "observe");
  assert.deepEqual(
    gateModes(memoryRepo({}, config({ "new-check": "enforce" })), defaults).problems.map((p) => p.check),
    ["loosened-gate-mode"],
  );
});

test("崩れた設定と、mode を守る検査を設定から変える書き方は止め、すべて enforce として扱う", () => {
  for (const text of [
    "{",
    JSON.stringify({ checks: { "missing-path": "warn" } }),
    JSON.stringify({ check: { "missing-path": "observe" } }),
    JSON.stringify({ checks: { "loosened-gate-mode": "off" } }),
  ]) {
    const modes = gateModes(memoryRepo({ [GATE_CONFIG_FILE]: text }));
    assert.deepEqual(
      modes.problems.map((p) => p.check),
      ["broken-gate-config"],
      text,
    );
    assert.equal(modes.modeOf("missing-path"), "enforce", text);
    assert.equal(modes.modeOf("loosened-gate-mode"), "enforce", text);
  }
});
