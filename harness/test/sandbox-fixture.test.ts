import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FIXTURE_COMMIT, extractFixture } from "../src/sandbox.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

test("見本の devboard は、リポジトリの固定したコミットの中身を取り出し、その後のコミットは混ざらない", (t) => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "autodev-fixture-test-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const home = join(tmp, "devboard");
  mkdirSync(join(home, "src"), { recursive: true });
  git(home, "init", "-q", "-b", "main");
  writeFileSync(join(home, "package.json"), '{"name":"devboard"}\n');
  writeFileSync(join(home, "src", "store.ts"), "export const version = 1;\n");
  git(home, "add", "-A");
  git(home, "commit", "-q", "-m", "feat: first");
  const pinned = git(home, "rev-parse", "HEAD");
  writeFileSync(join(home, "src", "store.ts"), "export const version = 2;\n");
  git(home, "commit", "-q", "-am", "feat: later change");

  const dest = join(tmp, "template", "tools", "devboard");
  extractFixture(home, pinned, dest);
  assert.equal(readFileSync(join(dest, "src", "store.ts"), "utf8"), "export const version = 1;\n");
  assert.equal(readFileSync(join(dest, "package.json"), "utf8"), '{"name":"devboard"}\n');
});

test("リポジトリに無いコミットは、取り出し方を添えて断る", (t) => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "autodev-fixture-test-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  git(tmp, "init", "-q", "-b", "main");
  assert.throws(() => extractFixture(tmp, FIXTURE_COMMIT, join(tmp, "out")), /git fetch --unshallow/);
});

test("固定するコミットは、40 桁の完全なハッシュにする", () => {
  assert.match(FIXTURE_COMMIT, /^[0-9a-f]{40}$/);
});
