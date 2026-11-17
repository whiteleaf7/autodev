import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTimings, runBuffered, runInherited } from "../src/steps.ts";

test("段ごとの所要時間と合計を、秒で 1 行に出す", () => {
  const line = formatTimings([
    { name: "速い検査", ms: 1250 },
    { name: "lint・型チェック（並列）", ms: 8000 },
    { name: "テスト", ms: 40_700 },
  ]);
  assert.equal(
    line,
    "check: 所要時間 速い検査 1.3 秒・lint・型チェック（並列） 8.0 秒・テスト 40.7 秒（合計 50.0 秒）",
  );
});

test("runBuffered は、出力をためて返し、終了コードを保つ", async () => {
  const options = { cwd: process.cwd(), env: process.env };
  const ok = await runBuffered("node", ["-e", "console.log('a'); console.error('b')"], options);
  assert.equal(ok.status, 0);
  assert.match(ok.output, /a/);
  assert.match(ok.output, /b/);
  const failed = await runBuffered("node", ["-e", "console.log('x'); process.exit(3)"], options);
  assert.equal(failed.status, 3);
  assert.match(failed.output, /x/);
});

test("runBuffered は、存在しないコマンドを、例外にせず、失敗として返す", async () => {
  const result = await runBuffered("autodev-no-such-command", [], { cwd: process.cwd(), env: process.env });
  assert.equal(result.status, 1);
  assert.match(result.output, /起動できない/);
});

test("runBuffered で並列に動かしても、それぞれの出力が混ざらない", async () => {
  const options = { cwd: process.cwd(), env: process.env };
  const [a, b] = await Promise.all([
    runBuffered("node", ["-e", "setTimeout(() => console.log('first'), 50)"], options),
    runBuffered("node", ["-e", "console.log('second')"], options),
  ]);
  assert.equal(a.output.trim(), "first");
  assert.equal(b.output.trim(), "second");
});

test("runBuffered は、子が裏に残したプロセスが出力を握ったままでも、子が終われば返す", async () => {
  const started = performance.now();
  const result = await runBuffered("sh", ["-c", "(sleep 30 &); echo done; exit 4"], {
    cwd: process.cwd(),
    env: process.env,
  });
  assert.ok(performance.now() - started < 10_000, "裏のプロセスが終わるまで待った");
  assert.equal(result.status, 4);
  assert.match(result.output, /^done\n/);
  assert.match(result.output, /出力を握ったままのプロセスが残っている/);
});

test("runInherited は、終了コードを返す", async () => {
  const options = { cwd: process.cwd(), env: process.env };
  assert.equal(await runInherited("node", ["-e", "process.exit(0)"], options), 0);
  assert.equal(await runInherited("node", ["-e", "process.exit(2)"], options), 2);
});
