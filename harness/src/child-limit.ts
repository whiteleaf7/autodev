// ゲートが待つ外のプロセス（git・devboard）の上限の時間。pre-commit のゲートが、lint より前で何も出さずに 30 分止まったことがある（T-286）。
// 終わらないプロセスを待ち続けず、どのコマンドで止まったかを添えて失敗にする。AUTODEV_CHILD_TIMEOUT_MS で変えられる（テスト用）

const DEFAULT_MS = 120_000;

export const childTimeoutMs = (): number => {
  const ms = Number(process.env.AUTODEV_CHILD_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_MS;
};

// spawnSync の結果の error か、execFileSync が投げたもの
export const isTimeout = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ETIMEDOUT";

export const timeoutMessage = (command: string, args: string[]): string =>
  `${[command, ...args].join(" ")} が ${childTimeoutMs() / 1000} 秒たっても終わらないので、止めて失敗にした`;

// execFileSync が上限で止められたなら、どのコマンドかを添えた例外に置き換える。それ以外の失敗は、呼んだ側が扱う
export function throwIfTimeout(error: unknown, command: string, args: string[]): void {
  if (isTimeout(error)) throw new Error(timeoutMessage(command, args), { cause: error });
}
