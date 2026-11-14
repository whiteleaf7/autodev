import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutGitEnv } from "../src/env.ts";

const env = withoutGitEnv(process.env);
const prune = join(import.meta.dirname, "../src/prune.ts");

function git(cwd: string, ...args: string[]): string {
  const config = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"];
  return execFileSync("git", [...config, "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env,
    encoding: "utf8",
  }).trim();
}

function branches(repo: string): string[] {
  return git(repo, "branch", "--format=%(refname:short)").split("\n").sort();
}

test("main の worktree が別のブランチを開いていても、main か origin/main に取り込まれた worktree を片付ける", () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "nagaya-prune-test-")));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "base");
  git(repo, "switch", "-q", "-c", "feat/other");

  const worktree = (name: string) => {
    const path = join(repo, ".claude/worktrees", name);
    git(repo, "worktree", "add", "-q", path, "-b", name, "main");
    git(path, "commit", "-q", "--allow-empty", "-m", name);
    return path;
  };
  const landed = worktree("landed");
  const pushed = worktree("pushed");
  const open = worktree("open");
  git(repo, "branch", "-f", "main", "landed"); // pnpm land がローカルの main を進めた
  git(repo, "update-ref", "refs/remotes/origin/main", "pushed"); // 別の clone から取り込まれ、fetch だけした

  const { status, stdout, stderr } = spawnSync("node", [prune], { cwd: repo, env, encoding: "utf8" });
  assert.equal(status, 0, `${stdout}${stderr}`);
  assert.ok(!existsSync(landed) && !existsSync(pushed), stdout);
  assert.ok(existsSync(open));
  assert.match(stdout, /残した: .*open（main に取り込まれていない）/);
  assert.deepEqual(branches(repo), ["feat/other", "main", "open"]);
});
