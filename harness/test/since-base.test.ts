import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LOOSENED_SINCE_BASE, sinceBase, unexplainedRemovals } from "../src/checks/since-base.ts";
import { memoryRepo, type Problem } from "../src/repo.ts";

const CHECK = join(import.meta.dirname, "..", "src", "check.ts");

const problem = (check: string, message = "m"): Problem => ({ check, file: "a.ts", message });

test("取り込み先と比べて初めて出る問題だけを、もとの検査の名前を添えて loosened-since-base にする", () => {
  const found = sinceBase(
    [problem("skipped-test")],
    [problem("skipped-test"), problem("neutered-script")],
    "origin/main",
  );
  assert.deepEqual(
    found.map((p) => p.check),
    [LOOSENED_SINCE_BASE],
  );
  assert.match(found[0]?.message ?? "", /^\[neutered-script\] m（origin\/main からの変更/);
});

const twoTests = `test("a", () => {\n  assert.equal(1, 1);\n});\ntest("b", () => {\n  assert.equal(2, 2);\n});\n`;
const oneTest = `test("a", () => {\n  assert.equal(1, 1);\n});\n`;

test("テストの減りは、範囲のどれかのコミットに、そのファイルの理由の行があれば通す", () => {
  const file = "packages/x/test/a.test.ts";
  const repo = memoryRepo(
    { "packages/x/package.json": "{}", [file]: oneTest },
    { "packages/x/package.json": "{}", [file]: twoTests },
  );
  assert.equal(unexplainedRemovals(repo, ["feat: a", "test: drop b"]).length, 1);
  assert.deepEqual(unexplainedRemovals(repo, ["feat: a", `test: drop b\n\nRemoved-test: ${file} -- flaky`]), []);
});

// T-268: land のゲートは rebase のあとのきれいな作業ツリーを見るので、HEAD と比べるだけでは、フックを通らずに入ったテストの削除を見逃す
test("--base を渡すと、フックを通らずにコミットしたテストの削除を、取り込み先と比べて見つける", (t) => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "autodev-since-base-test-")));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: repo,
      },
    );
  const noop = "node -e 0";
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "x", private: true, scripts: { lint: noop, typecheck: noop, test: noop } }),
  );
  mkdirSync(join(repo, "packages", "x", "test"), { recursive: true });
  writeFileSync(join(repo, "packages", "x", "package.json"), "{}\n");
  writeFileSync(join(repo, "packages", "x", "test", "a.test.ts"), twoTests);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "feat: base");
  git("switch", "-q", "-c", "work");
  writeFileSync(join(repo, "packages", "x", "test", "a.test.ts"), oneTest);
  git("commit", "-q", "--no-verify", "-am", "test: drop b");

  const { AUTODEV_ROOT: _, ...env } = process.env;
  const check = (args: string[], extra: NodeJS.ProcessEnv = {}) =>
    spawnSync(process.execPath, [CHECK, ...args], {
      cwd: repo,
      encoding: "utf8",
      env: { ...env, AUTODEV_NO_CACHE: "1", ...extra },
      timeout: 60_000,
    });
  const output = (r: ReturnType<typeof check>) => `${r.stdout}${r.stderr}`;

  const atHead = check([]);
  assert.equal(atHead.status, 0, output(atHead));
  assert.doesNotMatch(output(atHead), /loosened-since-base/);

  const observed = check(["--base", "main"]);
  assert.equal(observed.status, 0, "observe の間は止めない");
  assert.match(observed.stdout, /記録だけ（observe）: packages\/x\/: \[loosened-since-base\] \[removed-test\]/);

  const enforced = check(["--base", "main"], { AUTODEV_ENFORCE_DEFAULTS: "1" });
  assert.equal(enforced.status, 1);
  assert.match(enforced.stderr, /\[loosened-since-base\] \[removed-test\]/);

  git("commit", "-q", "--amend", "-m", "test: drop b\n\nRemoved-test: packages/x/test/a.test.ts -- flaky");
  const explained = check(["--base", "main"]);
  assert.equal(explained.status, 0, output(explained));
  assert.doesNotMatch(output(explained), /loosened-since-base/);

  const missing = check(["--base", "nowhere"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--base の nowhere を git で読めない/);
});
