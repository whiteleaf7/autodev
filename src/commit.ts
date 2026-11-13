// コミットメッセージの決まり（CLAUDE.md の「コミット」）を確かめる。git には触らず、渡された事実だけで判断する。

export type CommitFacts = {
  // このコミットで変更・追加・削除するタスクの ID（dev/tasks/T-NNN.json から）
  changedTasks: string[];
  // ボードにあるタスクの ID
  existingTasks: Set<string>;
};

const TYPES = ["feat", "fix", "docs", "chore", "test", "refactor", "perf", "style", "build", "ci", "revert"];
const CONVENTIONAL = new RegExp(`^(${TYPES.join("|")})(\\([^()\\s]+\\))?!?: \\S`);
// git が自分で作るメッセージ
const GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;

export function taskIdsOf(paths: string[]): string[] {
  return paths.map((path) => /^dev\/tasks\/(T-\d+)\.json$/.exec(path)?.[1]).filter((id): id is string => id !== undefined);
}

const BOARD_FILE = /^(dev|docs\/decisions)\//;

// ボードは main の worktree に 1 つだけ持つ（決定記録 0010）。作業用の worktree にあるのは古い写しなので、コミットしない
export function boardFilesOutsideMain(staged: string[], linkedWorktree: boolean): string[] {
  if (!linkedWorktree) return [];
  return staged
    .filter((path) => BOARD_FILE.test(path))
    .map((path) => `${path} はボードのファイル。ボードは main の worktree で管理するので、作業用の worktree ではコミットしない（git restore --staged ${path}）`);
}

export function checkMessage(message: string, facts: CommitFacts): string[] {
  const lines = message.split("\n").filter((line) => !line.startsWith("#"));
  const subject = lines.find((line) => line.trim()) ?? "";
  if (GENERATED.test(subject)) return [];

  const problems: string[] = [];
  if (!CONVENTIONAL.test(subject)) {
    problems.push(`件名を Conventional Commits にする（例: "feat: add recall tool"）。使える type: ${TYPES.join(" ")}`);
  }
  if (/[^\x00-\x7F]/.test(subject)) problems.push("件名は簡潔な英語で書く");

  const trailers = lines.filter((line) => /^Task:/i.test(line)).flatMap((line) => line.match(/T-\d+/g) ?? []);
  for (const id of new Set(trailers)) {
    if (!facts.existingTasks.has(id)) problems.push(`Task: の ${id} はボードに存在しない`);
  }
  for (const id of facts.changedTasks) {
    if (!trailers.includes(id)) problems.push(`dev/tasks/${id}.json を変更しているので、本文に「Task: ${id}」の行を入れる`);
  }
  return problems;
}
