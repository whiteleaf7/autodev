import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { exportBase, parseBootstrapArgs, toPascalCase, writeBootstrapFiles } from "../src/bootstrap.ts";
import { checkDocs } from "../src/checks/docs.ts";
import { lintDecisionFiles, requireToolNames } from "../src/devboard-cli.ts";
import { checkRecords } from "../src/checks/records.ts";
import { checkRules } from "../src/checks/rules.ts";
import { findRegion } from "../src/rules-region.ts";
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

  assert.equal(lstatSync(join(dir, "AGENTS.md")).isSymbolicLink(), false);
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.equal(existsSync(join(dir, ".codex/config.toml")), true);
  assert.equal(existsSync(join(dir, ".codex/hooks.json")), true);
  assert.equal(existsSync(join(dir, ".claude/settings.json")), true);
  assert.equal(existsSync(join(dir, ".mcp.json")), true);

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const repo = loadRepo(dir);
  assert.deepEqual(checkDocs(repo, requireToolNames(dir)), []);
  assert.deepEqual(
    checkRecords(repo, (files) => lintDecisionFiles(files, dir)),
    [],
  );
  assert.deepEqual(checkRules(repo), [], "AGENTS.md の共通の規約の区画が、common.md と同じ");
  assert.ok(findRegion(readFileSync(join(dir, "AGENTS.md"), "utf8")), "共通の規約を管理される区画として入れる");
});

const fileList = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .filter((rel) => !rel.startsWith(".git/"))
    .sort();

test("--source で展開元を指せる", () => {
  const opts = parseBootstrapArgs(["/tmp/my-project", "--source", "/tmp/some-base"]);
  assert.equal(opts.sourceRoot, "/tmp/some-base");
  assert.equal(parseBootstrapArgs(["/tmp/my-project"]).sourceRoot, undefined);
});

test("exportBase で作った展開元から、プロジェクトのディレクトリと同じ内容を展開できる", (t) => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "autodev-base-test-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const source = resolve(import.meta.dirname, "../../..");
  const base = join(tmp, "base");

  exportBase(source, base);
  const baseFiles = fileList(base);
  for (const needed of ["package.json", "tools/harness/src/bootstrap.ts", ".githooks/pre-commit", "docs/harness.md"]) {
    assert.ok(baseFiles.includes(needed), `${needed} が展開元に無い`);
  }
  assert.ok(
    !baseFiles.some((rel) => rel.startsWith("tools/harness/eval/heldout/") && !rel.endsWith(".gitkeep")),
    "最終評価用のシナリオを持ち込まない",
  );

  const options = { name: "sample-app", title: "SampleApp", summary: "概要", filesOnly: true };
  const fromProject = join(tmp, "from-project");
  const fromBase = join(tmp, "from-base");
  writeBootstrapFiles({ ...options, targetDir: fromProject });
  writeBootstrapFiles({ ...options, targetDir: fromBase, sourceRoot: base });
  assert.deepEqual(fileList(fromBase), fileList(fromProject));

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: fromBase });
  const repo = loadRepo(fromBase);
  assert.deepEqual(checkDocs(repo, requireToolNames(fromBase)), []);
  assert.deepEqual(
    checkRecords(repo, (files) => lintDecisionFiles(files, fromBase)),
    [],
  );
});

test("exportBase は、空でない出力先には書かない", (t) => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "autodev-base-test-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  writeFileSync(join(tmp, "old.txt"), "古い展開元");
  assert.throws(() => exportBase(resolve(import.meta.dirname, "../../.."), tmp), /空ではない/);
});
