import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const HOOK = join(import.meta.dirname, "..", "src", "hook.ts");
const testFile = (name: string) => `import { test } from "node:test";\ntest("${name}", () => {\n  assert.ok(true);\n});\n`;

test("commit-msg は、ステージしたテストの削除を、本文の Removed-test: の行があれば通し、無ければ止める", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-hook-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "tools", "x", "test"), { recursive: true });
  mkdirSync(join(dir, "tools", "x", "src"));
  writeFileSync(join(dir, "tools", "x", "package.json"), '{"scripts":{"typecheck":"tsc","test":"node --test"}}\n');
  writeFileSync(join(dir, "tools", "x", "src", "flaky.ts"), "export const flaky = 1;\n");
  writeFileSync(join(dir, "tools", "x", "test", "flaky.test.ts"), testFile("flaky"));
  writeFileSync(join(dir, "tools", "x", "test", "kept.test.ts"), testFile("kept"));
  git("add", "-A");
  git("commit", "-q", "-m", "feat: base");
  git("rm", "-q", "tools/x/test/flaky.test.ts");

  const commitMsg = (message: string) => {
    writeFileSync(join(dir, "MSG"), message);
    const { AUTODEV_ROOT: _, ...env } = process.env;
    return spawnSync(process.execPath, [HOOK, "commit-msg", join(dir, "MSG")], { cwd: dir, encoding: "utf8", env });
  };
  const blocked = commitMsg("test: drop the flaky test\n");
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /\[removed-test\].*tools\/x\/test\/flaky\.test\.ts/);
  const explained = commitMsg(
    "test: drop the flaky test\n\nRemoved-test: tools/x/test/flaky.test.ts -- 時々だけ落ち、原因が分からない\n",
  );
  assert.equal(explained.status, 0, explained.stderr);
  assert.equal(
    commitMsg("test: drop the flaky test\n\nRemoved-test: tools/x/test/kept.test.ts -- 別のファイル\n").status,
    1,
    "消していないファイルの行では通さない",
  );
});
