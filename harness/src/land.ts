// ブランチを、PR を通して main に 1 件ずつ取り込む（決定記録 0010、0015）。main 以外のブランチの上で `pnpm land` を実行する。
// 先に、ブランチのコミットに付いた roborev の開いた指摘を見せ、High が開いたままなら止める。
// 取り込みのロックを取り、origin/main に rebase して依存を入れ直し、その結果でゲート（autodev check --base origin/main）を通し、ブランチを push して draft の PR を作る。
// CI が通ったら PR を ready にして rebase でマージし、ローカルの main を origin/main に進める。
// main は、ローカルのゲートと CI を通った状態でしか進まない（.autodev/workflow.json の landWaitsForCi が false なら、ローカルのゲートだけ）。フックの設定に頼らずゲートを通すので、core.hooksPath が書き換えられても効く。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { withoutGitEnv } from "./env.ts";
import { ciVerdict, type Check, type Commit, NEEDS_TITLE, pullRequestBody, titleProblem } from "./pull-request.ts";
import {
  type BranchCommit,
  type CoveringJob,
  isUnfinished,
  type JobFindings,
  needsFindings,
  ReviewJob,
  ReviewShow,
  relevantJobs,
  reviewReport,
} from "./review-findings.ts";
import { parseWorkflowConfig, WORKFLOW_CONFIG_FILE, type WorkflowConfig } from "./workflow-config.ts";
import { parseWorktrees } from "./worktrees.ts";

const REMOTE = "origin";
const MAIN = "main";
const UPSTREAM = `${REMOTE}/${MAIN}`;
const WAIT_MS = 15 * 60_000;
const POLL_MS = 500;
const CI_WAIT_MS = 20 * 60_000;
const CI_POLL_MS = 10_000;
// レビューは 1 件あたり平均 19 秒（nagaya の 151 件）。コミットの直後の land でも、終わるのを待ってから指摘を読む
const REVIEW_WAIT_MS = 5 * 60_000;
const REVIEW_POLL_MS = 5_000;

class LandError extends Error {}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const { status, stdout, stderr } = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: status === 0, out: `${stdout ?? ""}${stderr ?? ""}`.trim() };
}

function gitOut(cwd: string, args: string[]): string {
  const { ok, out } = git(cwd, args);
  if (!ok) throw new LandError(`git ${args.join(" ")} が失敗した: ${out}`);
  return out;
}

function gh(cwd: string, args: string[]): string {
  const { status, stdout, stderr, error } = spawnSync("gh", args, { cwd, encoding: "utf8" });
  if (error) throw new LandError(`gh を実行できない（GitHub CLI を入れ、gh auth login する）: ${error.message}`);
  if (status !== 0) throw new LandError(`gh ${args.join(" ")} が失敗した: ${`${stdout}${stderr}`.trim()}`);
  return stdout.trim();
}

type Owner = { pid: number; branch: string };

function readOwner(lock: string): Owner | null {
  try {
    return JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")) as Owner;
  } catch {
    return null; // 取った直後で、まだ書いていない
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
}

// 取り込みは数十秒かかるので、時間ではなく、持ち主のプロセスが生きているかで、残ったロックを見分ける
async function withLandLock<T>(lock: string, branch: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  let announced = false;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, branch } satisfies Owner));
      break;
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
      const owner = readOwner(lock);
      if (owner && !alive(owner.pid)) {
        console.error(`land: ${owner.branch} の取り込みが途中で止まっていたので、ロックを外す`);
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline)
        throw new LandError(`取り込みのロック ${lock} が ${WAIT_MS / 60_000} 分たっても外れない`);
      if (!announced && owner) console.error(`land: ${owner.branch} の取り込みが終わるのを待っている`);
      announced = true;
      await sleep(POLL_MS);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function rebase(top: string, onto: string): void {
  if (git(top, ["rebase", "-q", onto]).ok) return;
  const conflicts = git(top, ["diff", "--name-only", "--diff-filter=U"]).out;
  git(top, ["rebase", "--abort"]);
  throw new LandError(
    `${onto} への rebase が衝突した（${conflicts.split("\n").join(", ") || "ファイル不明"}）。取り込みはしていない。` +
      `この worktree で git rebase ${onto} を実行して衝突を解消し、もう一度 pnpm land を実行する`,
  );
}

// rebase で main から新しい workspace のパッケージや依存が入ると、着手のときに作った node_modules では足りず、ゲートが落ちる（L-020）
function install(top: string): void {
  const { status } = spawnSync("pnpm", ["install", "--frozen-lockfile", "--offline"], {
    cwd: top,
    stdio: "inherit",
    env: withoutGitEnv(process.env),
  });
  if (status !== 0)
    throw new LandError(
      "rebase のあとの pnpm install --frozen-lockfile --offline が通らなかった。取り込みはしていない。" +
        "新しい依存がストアに無いときは、この worktree で pnpm install --frozen-lockfile を実行してから、もう一度 pnpm land を実行する",
    );
}

// プロジェクトの check スクリプトではなく、autodev のゲートを直接回す。取り込む変更が、同じ変更で check スクリプトを書き換えて、ゲートを外せないように。
// rebase のあとの作業ツリーは HEAD と同じで、HEAD と比べる検査は何も比べないので、取り込み先（origin/main）と比べる（T-268）
function gate(top: string): void {
  const { status } = spawnSync(process.execPath, [join(import.meta.dirname, "check.ts"), "--base", UPSTREAM], {
    cwd: top,
    stdio: "inherit",
    env: withoutGitEnv(process.env),
  });
  if (status !== 0)
    throw new LandError(
      `ゲート（autodev check --base ${UPSTREAM}）が通らなかった。取り込みはしていない。直してコミットし、もう一度 pnpm land を実行する`,
    );
}

function commitsOf(top: string, range: string): Commit[] {
  const log = gitOut(top, ["log", "--reverse", "--format=%s%x1f%b%x1e", range]);
  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject = "", body = ""] = entry.split("\x1f");
      return { subject, body };
    });
}

function existingPullRequest(top: string, branch: string): string {
  return gh(top, ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "--jq", ".[0].number"]);
}

// 同じブランチの開いた PR があれば使い回す（CI が落ちて直したあとの、2 回目の land）
function openPullRequest(top: string, branch: string, commits: Commit[], title: string | undefined): string {
  const existing = existingPullRequest(top, branch);
  if (existing) {
    if (title) gh(top, ["pr", "edit", existing, "--title", title]);
    return existing;
  }
  if (!title) throw new LandError(NEEDS_TITLE);
  const url = gh(top, [
    "pr",
    "create",
    "--draft",
    "--base",
    MAIN,
    "--head",
    branch,
    "--title",
    title,
    "--body",
    pullRequestBody(commits),
  ]);
  return url.split("/").pop() ?? url;
}

async function waitForCi(top: string, pr: string): Promise<void> {
  const deadline = Date.now() + CI_WAIT_MS;
  for (;;) {
    // 失敗したチェックがあると gh は 0 以外で終わるので、終了コードではなく中身で判断する
    const { stdout } = spawnSync("gh", ["pr", "checks", pr, "--json", "name,bucket"], { cwd: top, encoding: "utf8" });
    const verdict = ciVerdict(stdout?.trim() ? (JSON.parse(stdout) as Check[]) : []);
    if (verdict.state === "pass") return;
    if (verdict.state === "fail")
      throw new LandError(
        `PR #${pr} の CI が落ちた（${verdict.failed.join(", ")}）。マージはしていない。gh pr checks ${pr} で確かめて直し、コミットしてもう一度 pnpm land を実行する`,
      );
    if (Date.now() > deadline) throw new LandError(`PR #${pr} の CI が ${CI_WAIT_MS / 60_000} 分たっても終わらない`);
    await sleep(CI_POLL_MS);
  }
}

// GitHub の rebase マージはコミットを作り直すので、ブランチを origin/main に合わせてから main を進める。
// こうしておくと、pnpm worktree:prune が「取り込み済み」と判断して消せる
// rebase のあとの作業ツリーの設定を読む。崩れていれば、既定（CI を待つ）にして知らせる
function readWorkflowConfig(top: string): WorkflowConfig {
  const file = join(top, WORKFLOW_CONFIG_FILE);
  const { config, error } = parseWorkflowConfig(existsSync(file) ? readFileSync(file, "utf8") : null);
  if (error) console.error(`land: ${WORKFLOW_CONFIG_FILE} が崩れているので、既定で動く: ${error}`);
  return config;
}

function syncMain(top: string, branch: string): void {
  // GitHub がマージしたブランチを消すので、残った追跡のブランチと upstream を外す。
  // upstream が残っていると、git branch -d が「upstream に取り込まれていない」と断る
  gitOut(top, ["fetch", "-q", "--prune", REMOTE]);
  gitOut(top, ["reset", "-q", "--hard", UPSTREAM]);
  git(top, ["branch", "--unset-upstream", branch]);
  const worktrees = () => parseWorktrees(gitOut(top, ["worktree", "list", "--porcelain"]));
  const inMainWorktree = realpathSync(worktrees()[0]?.path ?? "") === top;
  if (inMainWorktree) gitOut(top, ["switch", "-q", MAIN]);
  const holder = worktrees().find((w) => w.branch === MAIN);
  if (!holder) gitOut(top, ["branch", "-f", MAIN, UPSTREAM]);
  else if (!git(holder.path, ["merge", "-q", "--ff-only", UPSTREAM]).ok)
    throw new LandError(
      `PR はマージした。${holder.path} の ${MAIN} を ${UPSTREAM} に fast-forward できなかったので、そこで git pull --ff-only を実行する`,
    );
  if (inMainWorktree) gitOut(top, ["branch", "-q", "-d", branch]);
}

function roborev(top: string, args: string[], input?: string): { ok: boolean; out: string } {
  const { status, stdout, stderr, error } = spawnSync("roborev", args, {
    cwd: top,
    encoding: "utf8",
    input,
    env: { ...process.env, ROBOREV_TELEMETRY_ENABLED: "0" },
  });
  if (error) return { ok: false, out: error.message };
  return { ok: status === 0, out: status === 0 ? stdout : `${stdout ?? ""}${stderr ?? ""}`.trim() };
}

function parseOut<T>(schema: z.ZodType<T>, out: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(out));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// 範囲の job（A..B）は、範囲のコミットすべてをレビューしている
function coveringJobs(top: string, jobs: ReviewJob[]): CoveringJob[] {
  return jobs.map((job) => {
    if (!job.git_ref.includes("..")) return { ...job, covers: [job.git_ref] };
    const range = git(top, ["rev-list", job.git_ref]);
    return { ...job, covers: range.ok ? range.out.split("\n").filter(Boolean) : [job.git_ref.split("..").pop() ?? ""] };
  });
}

function branchJobs(top: string, branch: string): CoveringJob[] | string {
  const list = roborev(top, ["job", "list", "--json", "--branch", branch, "--limit", "200"]);
  if (!list.ok) return `roborev job list が失敗した: ${list.out}`;
  const jobs = parseOut(z.array(ReviewJob), list.out);
  if (!jobs)
    return "roborev job list --json の出力の形が変わった。autodev の harness/src/review-findings.ts の ReviewJob を合わせる";
  return coveringJobs(top, jobs);
}

function findingsOf(top: string, jobs: CoveringJob[]): JobFindings {
  return new Map(
    jobs.filter(needsFindings).map((job) => {
      const show = roborev(top, ["job", "show", "--job", String(job.id), "--json"]);
      const findings = show.ok ? parseOut(ReviewShow, show.out)?.structured_output?.findings : null;
      return [job.id, findings ?? null] as const;
    }),
  );
}

// git が pre-push に標準入力で渡す 1 行（<ローカルの ref> <SHA> <リモートの ref> <リモートの SHA>）。
// リモートの SHA は、取り込み先と分かれたところにする。範囲がブランチのコミットだけになる
function pushedRefLine(top: string, branch: string): string {
  const ref = `refs/heads/${branch}`;
  return `${ref} ${gitOut(top, ["rev-parse", branch])} ${ref} ${gitOut(top, ["merge-base", UPSTREAM, branch])}\n`;
}

// 取り込むコミットに付いた roborev の開いた指摘を見せ、High が開いたままなら止める（T-290）。
// rebase で SHA が変わる前に、レビューされたコミットのままで読む。ロックの外で読むので、ほかの取り込みを待たせない
async function checkReviews(top: string, branch: string): Promise<void> {
  if (process.env.HARNESS_SKIP_REVIEW) return;
  if (!roborev(top, ["version"]).ok) {
    console.error("land: roborev が無いので、レビューの指摘は見ていない");
    return;
  }
  const commits: BranchCommit[] = gitOut(top, ["log", "--format=%H%x1f%s", `${UPSTREAM}..${branch}`])
    .split("\n")
    .filter(Boolean)
    .map((entry) => {
      const [sha = "", subject = ""] = entry.split("\x1f");
      return { sha, subject };
    });
  const mine = (jobs: CoveringJob[]) => relevantJobs(commits, jobs);

  // コミットのあとのレビューを「まとめ待ち」にする roborev の設定では、レビューは push の前（pre-push）に積まれる。
  // land は push より先に指摘を読むので、pre-push と同じ口でここで積み、終わるのを下で待つ。push のときには積み残しが無い
  const flushed = roborev(top, ["post-commit", "--flush-push"], pushedRefLine(top, branch));
  if (!flushed.ok) console.error(`land: roborev のまとめ待ちのレビューを積めなかった: ${flushed.out}`);

  const deadline = Date.now() + REVIEW_WAIT_MS;
  let jobs = branchJobs(top, branch);
  let announced = false;
  while (typeof jobs !== "string" && mine(jobs).some(isUnfinished) && Date.now() < deadline) {
    if (!announced) console.error("land: roborev のレビューが終わるのを待っている");
    announced = true;
    await sleep(REVIEW_POLL_MS);
    jobs = branchJobs(top, branch);
  }
  // 記録が読めないのは roborev の側の問題で、取り込む変更の問題ではないので、知らせて進める
  if (typeof jobs === "string") {
    console.error(`land: ${jobs}。レビューの指摘は見ていない`);
    return;
  }
  const report = reviewReport(commits, jobs, findingsOf(top, mine(jobs)));
  for (const line of report.lines) console.error(`land: ${line}`);
  if (report.blocked) throw new LandError("roborev の High の指摘が開いたまま。取り込みはしていない");
}

async function land(): Promise<void> {
  const { title } = parseArgs({ options: { title: { type: "string" } } }).values;
  const top = realpathSync(gitOut(process.cwd(), ["rev-parse", "--show-toplevel"]));
  const branch = gitOut(top, ["branch", "--show-current"]);
  if (!branch) throw new LandError("ブランチの上で実行する（detached HEAD になっている）");
  if (branch === MAIN)
    throw new LandError(`${MAIN} の上では使わない。ブランチを作るか、作業用の worktree の中で実行する`);
  if (gitOut(top, ["status", "--porcelain"]))
    throw new LandError("コミットしていない変更か、追跡していないファイルがある。コミットするか片付けてから実行する");
  if (!git(top, ["remote", "get-url", REMOTE]).ok) throw new LandError(`リモート ${REMOTE} が無い`);

  // タイトルが無いのに気づくのが、ゲートと push のあとにならないよう、先に確かめる
  const problem = titleProblem(title, Boolean(existingPullRequest(top, branch)));
  if (problem) throw new LandError(problem);

  gitOut(top, ["fetch", "-q", REMOTE, MAIN]);
  await checkReviews(top, branch);

  const lock = join(gitOut(top, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "autodev-land.lock");
  const merged = await withLandLock(lock, branch, async () => {
    gitOut(top, ["fetch", "-q", REMOTE, MAIN]);
    if (gitOut(top, ["rev-list", "--count", `${UPSTREAM}..${branch}`]) === "0")
      throw new LandError(`${UPSTREAM} に無いコミットが無い`);
    rebase(top, UPSTREAM);
    install(top);
    gate(top);
    // rebase で作り直したブランチを上書きする。main ではないので、force push の禁止には当たらない
    gitOut(top, ["push", "-q", "--force-with-lease", "-u", REMOTE, branch]);
    const head = gitOut(top, ["rev-parse", "HEAD"]);
    const pr = openPullRequest(top, branch, commitsOf(top, `${UPSTREAM}..${branch}`), title);
    if (readWorkflowConfig(top).landWaitsForCi) {
      console.error(`land: PR #${pr} の CI を待っている`);
      await waitForCi(top, pr);
    } else {
      console.error(
        `land: CI を待たずにマージする（${WORKFLOW_CONFIG_FILE} の landWaitsForCi）。CI は ${MAIN} への push で回る`,
      );
    }
    gh(top, ["pr", "ready", pr]);
    // ゲート（と CI）を通したコミットのままのときだけマージする
    gh(top, ["pr", "merge", pr, "--rebase", "--match-head-commit", head]);
    syncMain(top, branch);
    return pr;
  });
  console.log(
    `land: PR #${merged} をマージし、${MAIN} を進めた（${gitOut(top, ["log", "-1", "--format=%h %s", MAIN])}）`,
  );
}

try {
  await land();
} catch (e) {
  if (!(e instanceof LandError)) throw e;
  console.error(`land: ${e.message}`);
  process.exit(1);
}
