// 取り込み済みで変更の無い作業用の worktree と、そのブランチを片付ける（`pnpm worktree:prune`）。
// 取り込み済みかは、ローカルの main と origin/main で見る。main の worktree が main を開いているとは限らない（別のブランチの上で作業してよい）。
// worktree は git worktree remove（変更があれば断る）で外す。ブランチは取り込み済みを確かめたものだけを消す。
// git branch -d は main の worktree の HEAD と比べるので、そこが別のブランチだと取り込み済みでも断る。だから -D を使う。

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { parseWorktrees, planPrune } from "./worktrees.ts";

const MERGE_TARGETS = ["refs/heads/main", "refs/remotes/origin/main"];

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const { status, stdout, stderr } = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: status === 0, out: `${stdout ?? ""}${stderr ?? ""}`.trim() };
}

const here = realpathSync(git(process.cwd(), ["rev-parse", "--show-toplevel"]).out);
git(here, ["worktree", "prune"]); // ディレクトリが消えた worktree の記録を外す
const worktrees = parseWorktrees(git(here, ["worktree", "list", "--porcelain"]).out);
const main = worktrees[0]!;
const isMerged = (branch: string) =>
  MERGE_TARGETS.some((target) => git(main.path, ["merge-base", "--is-ancestor", branch, target]).ok);
const branches = worktrees.flatMap((w) => (w.branch ? [w.branch] : []));
const plan = planPrune(worktrees, {
  merged: new Set(branches.filter(isMerged)),
  dirty: new Set(worktrees.filter((w) => git(w.path, ["status", "--porcelain"]).out !== "").map((w) => w.path)),
  current: here,
});

let failed = false;
for (const worktree of plan.remove) {
  const removed = git(main.path, ["worktree", "remove", worktree.path]);
  const deleted = removed.ok ? git(main.path, ["branch", "-D", worktree.branch!]) : removed;
  failed ||= !deleted.ok;
  console.log(
    deleted.ok
      ? `片付けた: ${worktree.path}（${worktree.branch}）`
      : `片付けられなかった: ${worktree.path}: ${deleted.out}`,
  );
}
for (const { worktree, reason } of plan.keep.slice(1)) console.log(`残した: ${worktree.path}（${reason}）`);
if (failed) process.exit(1);
