import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendGateLog, readGateLog, summarizeGateLog, type GateLogEntry } from "../src/gate-log.ts";

const entry = (mode: GateLogEntry["mode"], check: string, file: string, at = 0): GateLogEntry => ({
  at,
  mode,
  check,
  file,
  line: 3,
  message: "m",
});

test("追記した記録を読み戻し、読めない行は飛ばす", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gate-log-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "nested", "log.jsonl");
  assert.deepEqual(readGateLog(file), [], "まだ無い");
  appendGateLog(file, [entry("observe", "a", "x.md")]);
  appendGateLog(file, [entry("enforce", "b", "y.md")]);
  assert.deepEqual(readGateLog(file), [entry("observe", "a", "x.md"), entry("enforce", "b", "y.md")]);
  writeFileSync(file, `{"at":1\nnot json\n${JSON.stringify(entry("observe", "a", "x.md"))}\n`);
  assert.deepEqual(readGateLog(file), [entry("observe", "a", "x.md")]);
});

test("mode と検査ごとに、同じ指摘をまとめて数え、回数の多い例から出す", () => {
  const summary = summarizeGateLog(
    [
      entry("observe", "missing-path", "a.md"),
      entry("observe", "missing-path", "b.md"),
      entry("observe", "missing-path", "b.md"),
      entry("observe", "missing-path", "c.md"),
      entry("enforce", "skipped-test", "t.test.ts"),
    ],
    2,
  );
  const lines = summary.split("\n");
  assert.equal(lines[0], "止めずに記録した（observe）");
  assert.match(lines[1]!, /^ {2}missing-path: 3 件の指摘を 4 回/);
  assert.equal(lines[2], "    b.md:3: m（2 回）");
  assert.equal(lines[4], "    ほか 1 件");
  assert.equal(lines[5], "止めた（enforce）");
  assert.match(lines[6]!, /^ {2}skipped-test: 1 件の指摘を 1 回/);
  assert.equal(summarizeGateLog([], 3), "記録は無い");
});
