import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutGitEnv } from "../src/env.ts";

test("git がフックに渡す GIT_ の変数を外し、ほかは残す", () => {
  const env = {
    GIT_DIR: "/repo/.git/worktrees/a",
    GIT_INDEX_FILE: "/repo/.git/worktrees/a/index",
    GIT_PREFIX: "",
    PATH: "/usr/bin",
    HOME: "/Users/me",
    MY_GIT_TOKEN: "x",
  };
  assert.deepEqual(withoutGitEnv(env), { PATH: "/usr/bin", HOME: "/Users/me", MY_GIT_TOKEN: "x" });
  assert.equal(env.GIT_DIR, "/repo/.git/worktrees/a", "渡したものは変えない");
});
