import { setTimeout as sleep } from "node:timers/promises";

// probe が null 以外を返すまで繰り返す。probe が投げても、期限までは「まだ」と見て続ける。
// 殻を立ち上げた直後は、画面の中の eval が殻の 10 秒の待ちを超えて失敗することがあり（L-048）、
// その 1 回で止めると、段に与えた待ちを使い切らないうちに落ちるため
export async function waitFor<T>(
  label: string,
  timeoutMs: number,
  probe: () => Promise<T | null>,
  pollMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== null) return value;
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(pollMs);
  }
  const cause = lastError === null ? "" : `。最後の失敗: ${lastError}`;
  throw new Error(`${label}（${timeoutMs / 1000} 秒待った）${cause}`);
}
