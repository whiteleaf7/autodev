// `git worktree list --porcelain` を読み、片付けてよい worktree を選ぶ。git には触らず、渡された事実だけで判断する。

export type Worktree = { path: string; branch: string | null; locked: boolean };

// 先頭が main の worktree（共通の .git を持つ場所）
export function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain
    .split(/\n\s*\n/)
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.trim().split("\n");
      const value = (key: string) =>
        lines.find((line) => line === key || line.startsWith(`${key} `))?.slice(key.length + 1);
      const branch = value("branch");
      return {
        path: value("worktree") ?? "",
        branch: branch ? branch.replace(/^refs\/heads\//, "") : null,
        locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
      };
    });
}

export type PruneFacts = {
  // main に取り込み済みのブランチ
  merged: Set<string>;
  // 未コミットの変更か、追跡していないファイルがある worktree
  dirty: Set<string>;
  // いま実行している worktree
  current: string;
};

export type PrunePlan = { remove: Worktree[]; keep: { worktree: Worktree; reason: string }[] };

export function planPrune(worktrees: Worktree[], facts: PruneFacts): PrunePlan {
  const plan: PrunePlan = { remove: [], keep: [] };
  worktrees.forEach((worktree, i) => {
    const reason =
      i === 0
        ? "main の worktree"
        : worktree.path === facts.current
          ? "いま使っている"
          : worktree.locked
            ? "ロックされている（使っているセッションがある）"
            : !worktree.branch
              ? "ブランチを開いていない（detached HEAD）"
              : !facts.merged.has(worktree.branch)
                ? "main に取り込まれていない"
                : facts.dirty.has(worktree.path)
                  ? "コミットしていない変更がある"
                  : null;
    if (reason) plan.keep.push({ worktree, reason });
    else plan.remove.push(worktree);
  });
  return plan;
}
