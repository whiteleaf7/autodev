// リポジトリにある記録（決定記録）の検査。決まりの中身は devboard の lint.ts にあり、ここはリポジトリの姿から入力を組み立てるだけ。
// タスク・教訓・マイルストーンは git の外の SQLite にあり、書く時点で store が検証する（決定記録 0011）

import { lintDecisions } from "@repo/devboard/src/lint.ts";
import type { Problem, Repo } from "../repo.ts";

const isDecisionFile = (path: string) => /^docs\/decisions\/[^/]+\.md$/.test(path);

export function checkRecords(repo: Repo): Problem[] {
  return lintDecisions(
    repo.files
      .filter(isDecisionFile)
      .sort()
      .map((file) => ({ file, text: repo.read(file) ?? "" })),
  );
}
