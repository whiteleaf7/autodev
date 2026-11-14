import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutGitEnv } from "../src/env.ts";
import { loadRepo } from "../src/repo.ts";
import { snapshotIndex } from "../src/snapshot.ts";

function git(cwd: string, ...args: string[]): void {
  const config = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"];
  execFileSync("git", [...config, "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: withoutGitEnv(process.env) });
}

function write(root: string, file: string, text: string): void {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
}

test("index の中身を写し、ステージしていない変更と追跡していないファイルは写さない", (t) => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "nagaya-snapshot-test-")));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "-q");
  write(repo, "package.json", "{}");
  write(repo, "pkg/package.json", "{}");
  write(repo, "pkg/a.ts", "base\n");
  write(repo, "pkg/b.ts", "base\n");
  git(repo, "add", "--", "package.json", "pkg");
  git(repo, "commit", "-q", "-m", "base");

  write(repo, "pkg/a.ts", "staged\n");
  git(repo, "add", "--", "pkg/a.ts");
  write(repo, "pkg/a.ts", "unstaged\n");
  write(repo, "pkg/b.ts", "unstaged\n");
  write(repo, "pkg/new.ts", "untracked\n");
  // pnpm の形: 外の依存は .pnpm の中を、workspace のパッケージはリポジトリの中を指す
  write(repo, "node_modules/.pnpm/dep/index.js", "dep\n");
  symlinkSync(join(repo, "node_modules/.pnpm/dep"), join(repo, "node_modules/dep"));
  mkdirSync(join(repo, "node_modules/@scope"));
  symlinkSync("../../pkg", join(repo, "node_modules/@scope/pkg"));

  const staged = snapshotIndex(repo);
  t.after(() => rmSync(staged.dir, { recursive: true, force: true }));
  const { dir } = staged;
  assert.equal(readFileSync(join(dir, "pkg/a.ts"), "utf8"), "staged\n");
  assert.equal(readFileSync(join(dir, "pkg/b.ts"), "utf8"), "base\n");
  assert.ok(!existsSync(join(dir, "pkg/new.ts")));
  assert.equal(readFileSync(join(dir, "node_modules/dep/index.js"), "utf8"), "dep\n");
  assert.equal(realpathSync(join(dir, "node_modules/@scope/pkg")), realpathSync(join(dir, "pkg")), "写しの中を指す");

  const loaded = loadRepo(repo, staged);
  assert.ok(!loaded.files.includes("pkg/new.ts"));
  assert.equal(loaded.read("pkg/a.ts"), "staged\n");
  assert.equal(loaded.base?.read("pkg/a.ts"), "base\n");
});
