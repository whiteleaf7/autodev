// リポジトリにある記録（決定記録）の検査。形式の決まりは devboard が持ち（devboard lint-decisions）、
// ここはリポジトリの姿から入力を組み立てて、検査の結果を受け取るだけ（検査の実行は check.ts が渡す）。
// タスク・教訓・マイルストーンは git の外の SQLite にあり、書く時点で devboard が検証する

import type { Problem, Tree } from "../repo.ts";

const isDecisionFile = (path: string) => /^docs\/decisions\/[^/]+\.md$/.test(path);

export type DecisionFile = { file: string; text: string };

export const decisionFiles = (tree: Tree): DecisionFile[] =>
  tree.files
    .filter(isDecisionFile)
    .toSorted()
    .map((file) => ({ file, text: tree.read(file) ?? "" }));

const sameDecisions = (a: DecisionFile[], b: DecisionFile[]) =>
  a.length === b.length && a.every((file, i) => file.file === b[i]?.file && file.text === b[i]?.text);

// 決定記録が、比べる先（基点、land なら取り込み先も）のどれとも同じなら、devboard を呼ばない。
// 変わっていない記録は、足したときに検査を通っている。番号の重なりのような記録どうしの決まりがあるので、変わったら全部を渡す。
// devboard が 120 秒たっても終わらずにゲートが落ちたことがあり（T-326）、外のプロセスを呼ぶ回数を減らす
export function checkRecords(
  tree: Tree,
  lint: (files: DecisionFile[]) => Problem[],
  compareWith: (Tree | null)[] = [],
): Problem[] {
  const files = decisionFiles(tree);
  const bases = compareWith.filter((base): base is Tree => base !== null);
  if (bases.length && bases.every((base) => sameDecisions(files, decisionFiles(base)))) return [];
  return lint(files);
}
