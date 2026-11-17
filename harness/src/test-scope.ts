// ゲートのテストを、触ったパッケージと、それに依存するパッケージだけに絞る。使うのは 2 か所。
// - 評価の複製: 評価は「ゲートが止めるか」を測るもので、触っていないパッケージのテストは結果を変えず、時間だけを使う
//   （2026-11 の実測: 1 シナリオのゲート 29 秒のうち、見本の devboard のテストが 15 秒、daemon が 7 秒）
// - PR の CI: 基点（AUTODEV_TEST_BASE）からの差分が届くテストだけを回す。取り込んだあとの main では、全部を回す

export const TEST_SCOPE_ENV = "AUTODEV_TEST_SCOPE";
export const TEST_BASE_ENV = "AUTODEV_TEST_BASE";

// ルートに置いたファイル（ロックファイル、ルートの package.json、lint や型の設定など）と CI の定義は、どのパッケージにも効きうる。
// 文書（.md）は、テストの結果を変えない
const reachesEveryPackage = (file: string) =>
  (!file.includes("/") && !file.endsWith(".md")) || file.startsWith(".github/");

// pnpm に渡す引数。絞れるのは、git の履歴があり、ルートの test が全パッケージを回す形（pnpm -r test）のときだけ。
// 別の形は、何を回すのか分からないので、そのまま回す。
// 差分の相手は、AUTODEV_TEST_BASE（無ければ HEAD。評価の複製の最初のコミットとの比較で、未コミットの変更を含む）。
// changedFromBase は、AUTODEV_TEST_BASE からの差分のファイル。null は、差分を取れなかったことを表し、絞らない
export function testArgs(
  env: NodeJS.ProcessEnv,
  rootTestScript: string | undefined,
  hasGit: boolean,
  changedFromBase: string[] | null = [],
): string[] {
  const scoped = env[TEST_SCOPE_ENV] === "changed" && hasGit && rootTestScript?.trim() === "pnpm -r test";
  if (!scoped || changedFromBase === null || changedFromBase.some(reachesEveryPackage)) return ["test"];
  const base = env[TEST_BASE_ENV];
  if (!base) return ["-r", "--filter", "...[HEAD]", "test"];
  // ルートのパッケージは、docs など、どのパッケージにも入らないファイルが変わっただけで「触った」に数えられ、その test（pnpm -r test）が全部を回してしまう。
  // テストに効くルートのファイルは、上で全部を回す側に分けてあるので、ここでは外す
  return ["-r", "--filter", `...[${base}]`, "--filter", "!{.}", "test"];
}
