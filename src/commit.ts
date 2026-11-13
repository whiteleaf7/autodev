// コミットメッセージの決まり（CLAUDE.md の「コミット」）を確かめる。git には触らず、渡された事実だけで判断する。

export type CommitFacts = {
  // ボード（SQLite）にあるタスクの ID
  existingTasks: Set<string>;
};

const TYPES = ["feat", "fix", "docs", "chore", "test", "refactor", "perf", "style", "build", "ci", "revert"];
const CONVENTIONAL = new RegExp(`^(${TYPES.join("|")})(\\([^()\\s]+\\))?!?: \\S`);
// git が自分で作るメッセージ
const GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;

const DECISION_FILE = /^docs\/decisions\//;

// 決定記録は main の worktree に書く（store がそこに書く。決定記録 0010、0011）。作業用の worktree にあるのは古い写しなので、コミットしない
export function decisionFilesOutsideMain(staged: string[], linkedWorktree: boolean): string[] {
  if (!linkedWorktree) return [];
  return staged
    .filter((path) => DECISION_FILE.test(path))
    .map(
      (path) =>
        `${path} は決定記録。決定記録は main の worktree で管理するので、作業用の worktree ではコミットしない（git restore --staged ${path}）`,
    );
}

// 一部だけステージしたファイルは整形しない。整形してステージし直すと、ステージしていない変更までコミットに入るため
export function filesToFormat(staged: string[], unstaged: string[]): { format: string[]; skipped: string[] } {
  const partial = new Set(unstaged);
  return { format: staged.filter((path) => !partial.has(path)), skipped: staged.filter((path) => partial.has(path)) };
}

export function checkMessage(message: string, facts: CommitFacts): string[] {
  const lines = message.split("\n").filter((line) => !line.startsWith("#"));
  const subject = lines.find((line) => line.trim()) ?? "";
  if (GENERATED.test(subject)) return [];

  const problems: string[] = [];
  if (!CONVENTIONAL.test(subject)) {
    problems.push(`件名を Conventional Commits にする（例: "feat: add recall tool"）。使える type: ${TYPES.join(" ")}`);
  }
  if (/\P{ASCII}/u.test(subject)) problems.push("件名は簡潔な英語で書く");

  const trailers = lines.filter((line) => /^Task:/i.test(line)).flatMap((line) => line.match(/T-\d+/g) ?? []);
  for (const id of new Set(trailers)) {
    if (!facts.existingTasks.has(id)) problems.push(`Task: の ${id} はボードに存在しない`);
  }
  return problems;
}
