// pnpm land が見せる、取り込むコミットに付いた roborev の開いた指摘（T-290）。roborev には触らず、渡された記録だけで判断する。
// High（と Critical）が開いたままなら取り込みを止め、Medium・Low は表示だけにする。
// 読むだけのレビューは誤検出もあるので、止めるのは本物の不具合が多かった High だけにし、閉じる理由を書けば通す（nagaya の決定記録 0066）

import { z } from "zod";

// `roborev job list --json` の 1 件。git_ref は 1 つのコミットの SHA か、まとめてレビューした範囲（A..B）
export const ReviewJob = z.object({
  id: z.number(),
  git_ref: z.string(),
  status: z.string(),
  closed: z.boolean().nullish(),
  verdict: z.string().nullish(),
});
export type ReviewJob = z.infer<typeof ReviewJob>;

export const Finding = z.object({
  severity: z.string(),
  problem: z.string(),
  location: z.string().nullish(),
});
export type Finding = z.infer<typeof Finding>;

// `roborev job show --job <id> --json`。指摘は structured_output にある（古い記録には無い）
export const ReviewShow = z.object({
  structured_output: z.object({ findings: z.array(Finding) }).nullish(),
});

export type BranchCommit = { sha: string; subject: string };
// covers: その job がレビューしたコミットの SHA（範囲の job は、範囲のコミットすべて）
export type CoveringJob = ReviewJob & { covers: string[] };
// 開いていて指摘のある（verdict が F の）job の指摘。読めなかった job は null
export type JobFindings = Map<number, Finding[] | null>;

const BLOCKING = new Set(["critical", "high"]);
const UNFINISHED = new Set(["queued", "running"]);
const PROBLEM_CHARS = 160;

export const isUnfinished = (job: ReviewJob) => UNFINISHED.has(job.status);
export const needsFindings = (job: ReviewJob) => job.status === "done" && !job.closed && job.verdict === "F";

export const relevantJobs = (commits: BranchCommit[], jobs: CoveringJob[]) =>
  jobs.filter((job) => job.covers.some((sha) => commits.some((c) => c.sha === sha)));

export type ReviewReport = { blocked: boolean; lines: string[] };

export function reviewReport(commits: BranchCommit[], jobs: CoveringJob[], findings: JobFindings): ReviewReport {
  const label = (sha: string) => {
    const commit = commits.find((c) => c.sha === sha);
    return `${sha.slice(0, 7)} ${commit?.subject ?? ""}`.trim();
  };
  const jobLabel = (job: CoveringJob) => {
    const mine = job.covers.filter((sha) => commits.some((c) => c.sha === sha));
    return `job ${job.id}（${mine.map(label).join("、")}）`;
  };
  const line = (job: CoveringJob, f: Finding) =>
    `  - ${jobLabel(job)} ${f.severity}${f.location ? ` ${f.location}` : ""}: ${shorten(f.problem)}`;

  const relevant = relevantJobs(commits, jobs);
  const blocking: string[] = [];
  const shown: string[] = [];
  const unreadable: CoveringJob[] = [];
  for (const job of relevant.filter(needsFindings)) {
    const list = findings.get(job.id);
    if (!list) {
      unreadable.push(job);
      continue;
    }
    for (const f of list) (BLOCKING.has(f.severity.toLowerCase()) ? blocking : shown).push(line(job, f));
  }

  const jobsOf = (sha: string) => relevant.filter((job) => job.covers.includes(sha));
  const unfinished = commits.filter((c) => {
    const own = jobsOf(c.sha);
    return own.some(isUnfinished) && !own.some((job) => job.status === "done");
  });
  const unreviewed = commits.filter((c) => !jobsOf(c.sha).some((job) => job.status === "done" || isUnfinished(job)));

  const lines: string[] = [];
  if (blocking.length) lines.push("roborev の High の指摘が開いたまま（取り込みを止める）:", ...blocking);
  if (unreadable.length)
    lines.push(
      "roborev の指摘の形が読めない（取り込みを止める。roborev job show --job <id> で読む）:",
      ...unreadable.map((job) => `  - ${jobLabel(job)}`),
    );
  if (shown.length) lines.push("roborev の Medium・Low の指摘（表示だけ）:", ...shown);
  if (unfinished.length)
    lines.push(
      "roborev のレビューがまだ終わっていない（指摘は見ていない）:",
      ...unfinished.map((c) => `  - ${label(c.sha)}`),
    );
  if (unreviewed.length)
    lines.push(
      "roborev のレビューが積まれていない（まとめてレビューする設定で待っている・失敗した、など。指摘は見ていない。roborev review <SHA> で積める）:",
      ...unreviewed.map((c) => `  - ${label(c.sha)}`),
    );

  const blocked = blocking.length > 0 || unreadable.length > 0;
  if (blocked)
    lines.push(
      "High は、直すか、直さない理由を書いて閉じてから、もう一度 pnpm land を実行する:",
      '  - 直す: 直してコミットし、roborev job comment --job <id> "<直したコミットと確かめたこと>" のあと roborev job close <id>',
      '  - 直さない: roborev job comment --job <id> "<直さない理由>" のあと roborev job close <id>',
    );
  return { blocked, lines };
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PROBLEM_CHARS ? `${flat.slice(0, PROBLEM_CHARS)}…` : flat;
}
