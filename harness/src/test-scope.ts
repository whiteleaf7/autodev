// 評価の複製では、ゲートのテストを、触ったパッケージと、それに依存するパッケージだけに絞る。
// 評価は「ゲートが止めるか」を測るもので、触っていないパッケージのテストは結果を変えず、時間だけを使うため
// （2026-11 の実測: 1 シナリオのゲート 29 秒のうち、見本の devboard のテストが 15 秒、daemon が 7 秒）

export const TEST_SCOPE_ENV = "AUTODEV_TEST_SCOPE";

// pnpm に渡す引数。絞れるのは、評価の複製（git の履歴がある）で、ルートの test が全パッケージを回す形（pnpm -r test）のときだけ。
// 別の形は、何を回すのか分からないので、そのまま回す。差分は、複製の最初のコミット（HEAD）との比較で、未コミットの変更を含む
export function testArgs(env: NodeJS.ProcessEnv, rootTestScript: string | undefined, hasGit: boolean): string[] {
  const scoped = env[TEST_SCOPE_ENV] === "changed" && hasGit && rootTestScript?.trim() === "pnpm -r test";
  return scoped ? ["-r", "--filter", "...[HEAD]", "test"] : ["test"];
}
