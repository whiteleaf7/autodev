import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorktrees, planPrune } from "../src/worktrees.ts";

const porcelain = `worktree /repo
HEAD 1111
branch refs/heads/main

worktree /repo/.claude/worktrees/agent-1
HEAD 2222
branch refs/heads/worktree-agent-1
locked claude agent

worktree /wt/done
HEAD 3333
branch refs/heads/feat/done

worktree /wt/open
HEAD 4444
branch refs/heads/feat/open

worktree /wt/dirty
HEAD 5555
branch refs/heads/feat/dirty

worktree /wt/detached
HEAD 6666
detached

`;

test("worktree の一覧を読む", () => {
  const worktrees = parseWorktrees(porcelain);
  assert.equal(worktrees.length, 6);
  assert.deepEqual(worktrees[0], { path: "/repo", branch: "main", locked: false });
  assert.deepEqual(worktrees[1], { path: "/repo/.claude/worktrees/agent-1", branch: "worktree-agent-1", locked: true });
  assert.deepEqual(worktrees[5], { path: "/wt/detached", branch: null, locked: false });
});

test("取り込み済みで変更の無い worktree だけを片付ける", () => {
  const worktrees = [...parseWorktrees(porcelain), { path: "/wt/here", branch: "feat/here", locked: false }];
  const plan = planPrune(worktrees, {
    merged: new Set(["main", "worktree-agent-1", "feat/done", "feat/dirty", "feat/here"]),
    dirty: new Set(["/wt/dirty"]),
    current: "/wt/here",
  });
  assert.deepEqual(
    plan.remove.map((w) => w.path),
    ["/wt/done"],
  );
  assert.deepEqual(
    plan.keep.map((k) => [k.worktree.path, k.reason]),
    [
      ["/repo", "main の worktree"],
      ["/repo/.claude/worktrees/agent-1", "ロックされている（使っているセッションがある）"],
      ["/wt/open", "main に取り込まれていない"],
      ["/wt/dirty", "コミットしていない変更がある"],
      ["/wt/detached", "ブランチを開いていない（detached HEAD）"],
      ["/wt/here", "いま使っている"],
    ],
  );
});
