// ブランチを、PR を通して main に 1 件ずつ取り込む（決定記録 0010、0015）。main 以外のブランチの上で `pnpm land` を実行する。
// 取り込みのロックを取り、origin/main に rebase し、その結果でゲート（pnpm check）を通し、ブランチを push して draft の PR を作る。
// CI が通ったら PR を ready にして rebase でマージし、ローカルの main を origin/main に進める。
// main は、ローカルのゲートと CI を通った状態でしか進まない。フックの設定に頼らずゲートを通すので、core.hooksPath が書き換えられても効く。

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withoutGitEnv } from "./env.ts";
import { ciVerdict, type Check, type Commit, pullRequestBody } from "./pull-request.ts";
import { parseWorktrees } from "./worktrees.ts";

const REMOTE = "origin";
const MAIN = "main";
const UPSTREAM = `${REMOTE}/${MAIN}`;
const WAIT_MS = 15 * 60_000;
const POLL_MS = 500;
const CI_WAIT_MS = 20 * 60_000;
const CI_POLL_MS = 10_000;

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
      await new Promise((r) => setTimeout(r, POLL_MS));
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

function gate(top: string): void {
  const { status } = spawnSync("pnpm", ["check"], { cwd: top, stdio: "inherit", env: withoutGitEnv(process.env) });
  if (status !== 0)
    throw new LandError(
      "ゲート（pnpm check）が通らなかった。取り込みはしていない。直してコミットし、もう一度 pnpm land を実行する",
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

// 同じブランチの開いた PR があれば使い回す（CI が落ちて直したあとの、2 回目の land）
function openPullRequest(top: string, branch: string, commits: Commit[]): string {
  const existing = gh(top, [
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "number",
    "--jq",
    ".[0].number",
  ]);
  if (existing) return existing;
  const url = gh(top, [
    "pr",
    "create",
    "--draft",
    "--base",
    MAIN,
    "--head",
    branch,
    "--title",
    commits[0]?.subject ?? branch,
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
    await new Promise((r) => setTimeout(r, CI_POLL_MS));
  }
}

// GitHub の rebase マージはコミットを作り直すので、ブランチを origin/main に合わせてから main を進める。
// こうしておくと、pnpm worktree:prune が「取り込み済み」と判断し、git branch -d で消せる
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

async function land(): Promise<void> {
  const top = realpathSync(gitOut(process.cwd(), ["rev-parse", "--show-toplevel"]));
  const branch = gitOut(top, ["branch", "--show-current"]);
  if (!branch) throw new LandError("ブランチの上で実行する（detached HEAD になっている）");
  if (branch === MAIN)
    throw new LandError(`${MAIN} の上では使わない。ブランチを作るか、作業用の worktree の中で実行する`);
  if (gitOut(top, ["status", "--porcelain"]))
    throw new LandError("コミットしていない変更か、追跡していないファイルがある。コミットするか片付けてから実行する");
  if (!git(top, ["remote", "get-url", REMOTE]).ok) throw new LandError(`リモート ${REMOTE} が無い`);

  const lock = join(gitOut(top, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "nagaya-land.lock");
  const merged = await withLandLock(lock, branch, async () => {
    gitOut(top, ["fetch", "-q", REMOTE, MAIN]);
    if (gitOut(top, ["rev-list", "--count", `${UPSTREAM}..${branch}`]) === "0")
      throw new LandError(`${UPSTREAM} に無いコミットが無い`);
    rebase(top, UPSTREAM);
    gate(top);
    // rebase で作り直したブランチを上書きする。main ではないので、force push の禁止には当たらない
    gitOut(top, ["push", "-q", "--force-with-lease", "-u", REMOTE, branch]);
    const head = gitOut(top, ["rev-parse", "HEAD"]);
    const pr = openPullRequest(top, branch, commitsOf(top, `${UPSTREAM}..${branch}`));
    console.error(`land: PR #${pr} の CI を待っている`);
    await waitForCi(top, pr);
    gh(top, ["pr", "ready", pr]);
    // CI を通したコミットのままのときだけマージする
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
