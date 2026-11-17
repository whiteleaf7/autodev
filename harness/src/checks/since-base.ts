// 取り込み（autodev land）のゲートは、rebase のあとのきれいな作業ツリーを見るので、HEAD と比べる検査は何も比べられない。
// そこで、取り込み先のブランチ（origin/main）と比べ直し、HEAD と比べても出ない問題（コミットのゲートを --no-verify などで通らずに入った緩め）を拾う（T-268）

import { unexplainedRemovedTests } from "../commit.ts";
import { formatProblem, type Problem, type Repo } from "../repo.ts";
import { findRemovedTests, REMOVED_TEST, removedTestMessage } from "./gate.ts";

export const LOOSENED_SINCE_BASE = "loosened-since-base";

// テストの減りは、範囲のどれかのコミットの本文に、そのファイルの「Removed-test:」の行があれば通す（コミットのときと同じ決まり）
export function unexplainedRemovals(repo: Repo, messages: string[]): Problem[] {
  if (!repo.base) return [];
  return findRemovedTests(repo, repo.base).flatMap((removed) => {
    const missing = removed.files.filter((file) =>
      messages.every((message) => unexplainedRemovedTests(message, [file]).length > 0),
    );
    return missing.length
      ? [{ check: REMOVED_TEST, file: `${removed.dir}/`, message: removedTestMessage({ ...removed, files: missing }) }]
      : [];
  });
}

// 基点のブランチと比べて初めて出る問題を、1 つの検査（loosened-since-base）にまとめる。HEAD と比べても出るものは、もとの検査のまま止める
export function sinceBase(atHead: Problem[], atBase: Problem[], base: string): Problem[] {
  const seen = new Set(atHead.map(formatProblem));
  return atBase
    .filter((problem) => !seen.has(formatProblem(problem)))
    .map((problem) => ({
      ...problem,
      check: LOOSENED_SINCE_BASE,
      message: `[${problem.check}] ${problem.message}（${base} からの変更で見つかった。コミットのゲートを通らずに入っている）`,
    }));
}
