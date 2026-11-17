// リポジトリにある記録（決定記録）の検査。形式の決まりは devboard が持ち（devboard lint-decisions）、
// ここはリポジトリの姿から入力を組み立てて、検査の結果を受け取るだけ（検査の実行は check.ts が渡す）。
// タスク・教訓・マイルストーンは git の外の SQLite にあり、書く時点で devboard が検証する

import type { Problem, Repo } from "../repo.ts";

const isDecisionFile = (path: string) => /^docs\/decisions\/[^/]+\.md$/.test(path);

export type DecisionFile = { file: string; text: string };

export const decisionFiles = (repo: Repo): DecisionFile[] =>
  repo.files
    .filter(isDecisionFile)
    .toSorted()
    .map((file) => ({ file, text: repo.read(file) ?? "" }));

export const checkRecords = (repo: Repo, lint: (files: DecisionFile[]) => Problem[]): Problem[] =>
  lint(decisionFiles(repo));
