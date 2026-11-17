// 変異テストが、変異 1 件ごとに回す検査のコマンドを作る。
// pnpm を介すと、起動だけで 1 回 0.3 秒かかる（型チェックとテストで 2 回、変異 1 件の約 6 割。2026-11 の実測）。
// パッケージのスクリプトが単純な形なら、その中身を直接回す。テストは、変異を入れたファイルに届くものを先に回し、
// 通ったときだけ残りを回す（全部を 2 度回さない）。判定の式（型かテストのどれかが落ちれば止めた）は変えない

export type Scripts = { typecheck?: string; test?: string };

// `node [フラグ] --test [フラグ] test/*.test.ts` の形のとき、末尾の glob を除いた前半
function testPrefix(script: string | undefined): string | null {
  const match = script?.trim().match(/^(node\s.*\s--test\b.*?)\s+test\/\*\.test\.ts$/);
  return match ? match[1]! : null;
}

// 直接回せない形（pnpm を呼ぶ、複数の手順がある、別の形のテスト）のときは null。呼び出し側が、これまでの pnpm 経由に落とす
export function directCommand(scripts: Scripts, related: string[], allTests: string[]): string | null {
  const prefix = testPrefix(scripts.test);
  const typecheck = scripts.typecheck?.trim();
  if (!prefix || !typecheck || /\bpnpm\b|&&|;|\|/.test(typecheck)) return null;
  const rest = allTests.filter((file) => !related.includes(file));
  const steps = [typecheck];
  if (related.length) steps.push(`${prefix} ${related.join(" ")}`);
  if (rest.length) steps.push(`${prefix} ${rest.join(" ")}`);
  // pnpm が足していた node_modules/.bin（パッケージのものと、ルートのもの）を PATH に足す
  return `PATH="$PWD/node_modules/.bin:$PWD/../../node_modules/.bin:$PATH"; ${steps.join(" && ")}`;
}

// パッケージの test/ の直下にある *.test.ts（`test/*.test.ts` の glob が拾うもの）。パッケージからの相対パス
export function testFilesOf(files: string[], packageDir: string): string[] {
  const prefix = packageDir === "." ? "" : `${packageDir}/`;
  return files
    .filter((f) => f.startsWith(`${prefix}test/`) && /^test\/[^/]*\.test\.ts$/.test(f.slice(prefix.length)))
    .map((f) => f.slice(prefix.length))
    .sort();
}
