import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

const CHECK = join(import.meta.dirname, "..", "src", "check.ts");

// T-286: pre-commit のゲートが、lint より前で 30 分止まった。待っている外のプロセスが終わらないときは、名前を添えて上限で失敗にする
test("ゲートが待つ devboard が終わらないと、コマンドの名前を添えて、上限の時間で失敗する", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-check-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  const bin = join(dir, "bin");
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(join(bin, "devboard"), "#!/bin/sh\nexec sleep 60\n");
  chmodSync(join(bin, "devboard"), 0o755);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: repo,
      },
    );
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "package.json"), '{"name":"x","private":true}\n');
  git("add", "-A");
  git("commit", "-q", "-m", "feat: base");
  writeFileSync(join(repo, "README.md"), "# x\n");
  git("add", "README.md");

  const { AUTODEV_ROOT: _, ...env } = process.env;
  const started = performance.now();
  const result = spawnSync(process.execPath, [CHECK, "--staged"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...env,
      PATH: `${bin}${delimiter}${env.PATH ?? ""}`,
      AUTODEV_CHILD_TIMEOUT_MS: "3000",
      AUTODEV_NO_CACHE: "1",
    },
    timeout: 20_000,
  });
  assert.equal(result.error, undefined, "ゲートが上限の時間で止まらず、待ち続けた");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /devboard tools が 3 秒たっても終わらない/);
  assert.ok(performance.now() - started < 15_000);
});
