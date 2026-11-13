// 作業用の worktree のブランチを、main に 1 件ずつ取り込む（決定記録 0010）。作業用の worktree の中で `pnpm land` を実行する。
// 取り込みのロックを取り、main に rebase し、その結果でゲート（pnpm check）を通し、main の worktree で fast-forward する。
// main は、ゲートを通った状態でしか進まない。フックの設定に頼らずゲートを通すので、core.hooksPath が書き換えられても効く。

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withoutGitEnv } from "./env.ts";
import { parseWorktrees } from "./worktrees.ts";

// ボードの変更だけのコミットが main に入ると fast-forward できなくなるので、rebase からやり直す回数
const ATTEMPTS = 3;
const WAIT_MS = 15 * 60_000;
const POLL_MS = 500;

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
async function withLandLock<T>(lock: string, branch: string, fn: () => T): Promise<T> {
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
      if (Date.now() > deadline) throw new LandError(`取り込みのロック ${lock} が ${WAIT_MS / 60_000} 分たっても外れない`);
      if (!announced && owner) console.error(`land: ${owner.branch} の取り込みが終わるのを待っている`);
      announced = true;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  try {
    return fn();
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
  if (status !== 0) throw new LandError("ゲート（pnpm check）が通らなかった。取り込みはしていない。直してコミットし、もう一度 pnpm land を実行する");
}

async function land(): Promise<void> {
  const top = realpathSync(gitOut(process.cwd(), ["rev-parse", "--show-toplevel"]));
  const [main] = parseWorktrees(gitOut(top, ["worktree", "list", "--porcelain"]));
  if (!main || realpathSync(main.path) === top) throw new LandError("main の worktree では使わない。作業用の worktree の中で実行する");
  if (!main.branch) throw new LandError(`main の worktree（${main.path}）がブランチを開いていない`);
  const branch = gitOut(top, ["branch", "--show-current"]);
  if (!branch) throw new LandError("ブランチの上で実行する（detached HEAD になっている）");
  if (gitOut(top, ["status", "--porcelain"])) throw new LandError("コミットしていない変更か、追跡していないファイルがある。コミットするか片付けてから実行する");
  if (gitOut(top, ["rev-list", "--count", `${main.branch}..${branch}`]) === "0") throw new LandError(`${main.branch} に無いコミットが無い`);

  const lock = join(gitOut(top, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "nagaya-land.lock");
  await withLandLock(lock, branch, () => {
    for (let attempt = 1; ; attempt++) {
      rebase(top, main.branch!);
      gate(top);
      const merged = git(main.path, ["merge", "-q", "--ff-only", branch]);
      if (merged.ok) break;
      const mainMoved = !git(top, ["merge-base", "--is-ancestor", main.branch!, branch]).ok;
      if (!mainMoved || attempt === ATTEMPTS) {
        throw new LandError(`main の worktree（${main.path}）で fast-forward できなかった。取り込みはしていない: ${merged.out}`);
      }
      console.error(`land: ゲートの間に ${main.branch} が進んだので、rebase からやり直す`);
    }
  });
  console.log(`land: ${branch} を ${main.branch} に取り込んだ（${gitOut(top, ["log", "-1", "--format=%h %s"])}）`);
}

try {
  await land();
} catch (e) {
  if (!(e instanceof LandError)) throw e;
  console.error(`land: ${e.message}`);
  process.exit(1);
}
