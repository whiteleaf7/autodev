import { test } from "node:test";
import assert from "node:assert/strict";
import { waitFor } from "../src/wait.ts";

test("確かめる途中で投げても、期限までは続けて、真になった値を返す", async () => {
  let calls = 0;
  const value = await waitFor(
    "ならない",
    1_000,
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("The page returned no value within 10000ms");
      return calls === 3 ? "connected" : null;
    },
    1,
  );
  assert.equal(value, "connected");
  assert.equal(calls, 3);
});

test("期限まで真にならなければ、最後の失敗を添えて投げる", async () => {
  await assert.rejects(
    waitFor(
      "画面がこの状態にならない",
      50,
      async () => {
        throw new Error("The page returned no value within 10000ms");
      },
      1,
    ),
    /^Error: 画面がこの状態にならない（0\.05 秒待った）。最後の失敗: The page returned no value within 10000ms$/,
  );
});

test("最後の確かめが失敗でなければ、前の失敗は添えない", async () => {
  let calls = 0;
  await assert.rejects(
    waitFor(
      "ならない",
      50,
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("一時的な失敗");
        return null;
      },
      1,
    ),
    (error: unknown) => error instanceof Error && error.message === "ならない（0.05 秒待った）",
  );
});
