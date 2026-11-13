// コミットメッセージの決まり（CLAUDE.md の「コミット」）を確かめる。git には触らず、渡された事実だけで判断する。

export type CommitFacts = {
  // ボード（SQLite）にあるタスクの ID
  existingTasks: Set<string>;
};

const TYPES = ["feat", "fix", "docs", "chore", "test", "refactor", "perf", "style", "build", "ci", "revert"];
const CONVENTIONAL = new RegExp(`^(${TYPES.join("|")})(\\([^()\\s]+\\))?!?: \\S`);
// git が自分で作るメッセージ
const GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;

// 一部だけステージしたファイルは整形しない。整形してステージし直すと、ステージしていない変更までコミットに入るため
export function filesToFormat(staged: string[], unstaged: string[]): { format: string[]; skipped: string[] } {
  const partial = new Set(unstaged);
  return { format: staged.filter((path) => !partial.has(path)), skipped: staged.filter((path) => partial.has(path)) };
}

// pre-push が標準入力で受け取る行（<ローカルの ref> <SHA> <リモートの ref> <SHA>）から、main への push を見つける。
// main は PR でしか進めない（決定記録 0015）。GitHub Free の private ではルールセットが使えないので、ここで止める
export function pushesToMain(refs: string): boolean {
  return refs.split("\n").some((line) => line.trim().split(/\s+/)[2] === "refs/heads/main");
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
