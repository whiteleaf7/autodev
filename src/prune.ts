// 取り込み済みで変更の無い作業用の worktree と、そのブランチを片付ける（`pnpm worktree:prune`）。
// git worktree remove（変更があれば断る）と git branch -d（取り込まれていなければ断る）だけを使うので、作業は消えない。

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { parseWorktrees, planPrune } from "./worktrees.ts";

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const { status, stdout, stderr } = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: status === 0, out: `${stdout ?? ""}${stderr ?? ""}`.trim() };
}

const here = realpathSync(git(process.cwd(), ["rev-parse", "--show-toplevel"]).out);
git(here, ["worktree", "prune"]); // ディレクトリが消えた worktree の記録を外す
const worktrees = parseWorktrees(git(here, ["worktree", "list", "--porcelain"]).out);
const main = worktrees[0];
if (!main?.branch) {
  console.error("worktree:prune: main の worktree がブランチを開いていない");
  process.exit(1);
}
const branches = worktrees.flatMap((w) => (w.branch ? [w.branch] : []));
const plan = planPrune(worktrees, {
  merged: new Set(branches.filter((b) => git(main.path, ["merge-base", "--is-ancestor", b, main.branch!]).ok)),
  dirty: new Set(worktrees.filter((w) => git(w.path, ["status", "--porcelain"]).out !== "").map((w) => w.path)),
  current: here,
});

let failed = false;
for (const worktree of plan.remove) {
  const removed = git(main.path, ["worktree", "remove", worktree.path]);
  const deleted = removed.ok ? git(main.path, ["branch", "-d", worktree.branch!]) : removed;
  failed ||= !deleted.ok;
  console.log(
    deleted.ok
      ? `片付けた: ${worktree.path}（${worktree.branch}）`
      : `片付けられなかった: ${worktree.path}: ${deleted.out}`,
  );
}
for (const { worktree, reason } of plan.keep.slice(1)) console.log(`残した: ${worktree.path}（${reason}）`);
if (failed) process.exit(1);
