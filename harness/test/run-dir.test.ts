import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { STALE_MS, staleRunDirs } from "../src/run-dir.ts";

const runDirModule = new URL("../src/run-dir.ts", import.meta.url).pathname;
const script = (body: string) => `import { runDir } from ${JSON.stringify(runDirModule)}; const dir = runDir(); console.log(dir); ${body}`;

test("持ち主がいなくて、古い親ディレクトリだけを、掃除の対象にする", () => {
  const now = 10 * STALE_MS;
  const entries = [
    { name: "autodev-run-111-aaaaaa", mtimeMs: now - 2 * STALE_MS }, // 古く、持ち主がいない
    { name: "autodev-run-222-bbbbbb", mtimeMs: now - 2 * STALE_MS }, // 古いが、持ち主が居る
    { name: "autodev-run-111-cccccc", mtimeMs: now - 1000 }, // 持ち主がいないが、新しい
    { name: "autodev-scenario-xxxxxx", mtimeMs: 0 }, // この仕組みのものではない
  ];
  assert.deepEqual(staleRunDirs(entries, now, (pid) => pid === 222), ["autodev-run-111-aaaaaa"]);
});

test("実行が終わると、親ディレクトリごと消える", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script("")], { encoding: "utf8" });
  const dir = result.stdout.trim();
  assert.match(dir, /autodev-run-\d+-/);
  assert.equal(existsSync(dir), false);
});

test("SIGTERM で止められても、親ディレクトリごと消えて、終了コードは 143", async () => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", script("setInterval(() => {}, 1000);")]);
  const dir = await new Promise<string>((resolve) => {
    child.stdout.once("data", (chunk) => resolve(String(chunk).trim()));
  });
  assert.equal(existsSync(dir), true);
  const code = await new Promise<number | null>((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
  assert.equal(code, 143);
  assert.equal(existsSync(dir), false);
});
