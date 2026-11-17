import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// chrome.ts は読み込むときに Chrome の場所を決めるので、差し替えてから読む
process.env.VERIFY_CHROME = fileURLToPath(new URL("./fake-chrome.cjs", import.meta.url));
const { withChrome } = await import("../src/chrome.ts");

async function elapsedOf(run: () => Promise<unknown>): Promise<{ ms: number; error: unknown }> {
  const start = Date.now();
  const error = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  return { ms: Date.now() - start, error };
}

test("CDP が答えないと、メソッド名を添えて上限で失敗にする", async () => {
  // 負荷の高い機械では Chrome の起動が返事の上限より遅れる。起動が遅くても、返事の上限で失敗にすること（T-287）
  process.env.FAKE_CHROME_START_DELAY_MS = "1000";
  try {
    const { ms, error } = await elapsedOf(() =>
      withChrome(30_000, (browser) => browser.grant("http://127.0.0.1", ["notifications"]), { replyTimeoutMs: 500 }),
    );
    assert.match(String(error), /Browser\.grantPermissions に 500ms 経っても返事が来ない/);
    // 上限（500ms）を、負荷の高い機械でも数十秒は超えないこと。固まって返らないことだけを、はっきり区別できればよい
    assert.ok(ms < 20_000, `${ms}ms かかった`);
  } finally {
    delete process.env.FAKE_CHROME_START_DELAY_MS;
  }
});

test("接続が切れたら、返事待ちの要求を上限を待たずに失敗にする", async () => {
  process.env.FAKE_CHROME_DROP = "1";
  try {
    const { ms, error } = await elapsedOf(() =>
      withChrome(30_000, (browser) => browser.grant("http://127.0.0.1", ["notifications"])),
    );
    assert.match(String(error), /DevTools の接続が切れた/);
    assert.ok(ms < 20_000, `${ms}ms かかった（上限の 30 秒を待たない）`);
  } finally {
    delete process.env.FAKE_CHROME_DROP;
  }
});

test("SIGTERM を無視する Chrome も、3 秒で SIGKILL して片付ける", async () => {
  process.env.FAKE_CHROME_IGNORE_SIGTERM = "1";
  try {
    const { ms, error } = await elapsedOf(() => withChrome(5_000, async () => "done"));
    assert.equal(error, undefined);
    assert.ok(ms >= 3_000 && ms < 30_000, `${ms}ms かかった（3 秒待って SIGKILL する）`);
  } finally {
    delete process.env.FAKE_CHROME_IGNORE_SIGTERM;
  }
});
