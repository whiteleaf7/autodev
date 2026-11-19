// pnpm land が作る PR の中身と、CI の結果の読み方。gh には触らず、渡された事実だけで判断する。

export type Commit = { subject: string; body: string };

// テンプレートが無いので、Summary だけを書く（ユーザーの決まり）。Task: の行は、コミットから集めて最後に置く
export function pullRequestBody(commits: Commit[]): string {
  const tasks = [...new Set(commits.flatMap(({ body }) => body.match(/^Task:.*$/gm) ?? []))];
  const lines = ["## Summary", "", ...commits.map(({ subject }) => `- ${subject}`)];
  if (tasks.length) lines.push("", ...tasks);
  return `${lines.join("\n")}\n`;
}

// PR のタイトルは、取り込む人が決めて渡す。コミットの件名をそのまま使うと、複数のコミットのときに 1 件目だけを指してしまう。
// 形はプロジェクトの AGENTS.md の決まりに任せ、ここでは見ない。使い回す PR は、渡されたときだけ付け直す
export const NEEDS_TITLE =
  '新しく PR を作るので、--title でタイトルを渡す（例: pnpm land --title "<タイトル>"）。形はプロジェクトの AGENTS.md の決まりに従う';

export function titleProblem(title: string | undefined, hasOpenPullRequest: boolean): string | null {
  if (title !== undefined && !title.trim()) return "--title が空。PR のタイトルを渡す";
  if (title === undefined && !hasOpenPullRequest) return NEEDS_TITLE;
  return null;
}

// `gh pr checks --json bucket` の bucket は pass / fail / pending / skipping / cancel
export type Check = { name: string; bucket: string };
export type CiVerdict = { state: "pending" } | { state: "pass" } | { state: "fail"; failed: string[] };

// push した直後は、チェックがまだ 1 つも登録されていないことがあるので、空は待つ
export function ciVerdict(checks: Check[]): CiVerdict {
  const failed = checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel").map((c) => c.name);
  if (failed.length) return { state: "fail", failed };
  if (!checks.length || checks.some((c) => c.bucket === "pending")) return { state: "pending" };
  return { state: "pass" };
}
