import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseBootstrapArgs, toPascalCase, writeBootstrapFiles } from "../src/bootstrap.ts";
import { checkDocs } from "../src/checks/docs.ts";
import { checkRecords } from "../src/checks/records.ts";
import { loadRepo } from "../src/repo.ts";
import { execFileSync } from "node:child_process";

test("toPascalCase と parseBootstrapArgs はディレクトリ名からプロジェクト名と表示名を決める", () => {
  assert.equal(toPascalCase("jw-crew"), "JwCrew");
  assert.equal(toPascalCase("sample_app"), "SampleApp");
  const opts = parseBootstrapArgs(["/tmp/my-project"]);
  assert.equal(opts.name, "my-project");
  assert.equal(opts.title, "MyProject");
  assert.equal(opts.filesOnly, false);

  const custom = parseBootstrapArgs(["/tmp/dir", "--name", "jwcrew", "--title", "JwCrew", "--files-only"]);
  assert.equal(custom.name, "jwcrew");
  assert.equal(custom.title, "JwCrew");
  assert.equal(custom.filesOnly, true);
});

test("writeBootstrapFiles はマルチエージェント対応の基盤一式を展開し、docs と records の検査を通る", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-bootstrap-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeBootstrapFiles({
    targetDir: dir,
    name: "sample-app",
    title: "SampleApp",
    summary: "SampleApp の概要",
    filesOnly: true,
  });

  assert.equal(lstatSync(join(dir, "AGENTS.md")).isSymbolicLink(), true);
  assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), readFileSync(join(dir, "CLAUDE.md"), "utf8"));
  assert.equal(existsSync(join(dir, ".codex/config.toml")), true);
  assert.equal(existsSync(join(dir, ".codex/hooks.json")), true);
  assert.equal(existsSync(join(dir, ".claude/settings.json")), true);
  assert.equal(existsSync(join(dir, ".mcp.json")), true);

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const repo = loadRepo(dir);
  assert.deepEqual(checkDocs(repo), []);
  assert.deepEqual(checkRecords(repo), []);
});
