import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkConventions } from "../src/checks/conventions.ts";
import { checkDocs } from "../src/checks/docs.ts";
import { checkGate } from "../src/checks/gate.ts";
import { checkRecords } from "../src/checks/records.ts";
import { checkRules } from "../src/checks/rules.ts";
import { lintDecisionFiles, requireToolNames } from "../src/devboard-cli.ts";
import { parseInitArgs, renderTemplate, toPascalCase, writeInitFiles } from "../src/init.ts";
import { loadRepo } from "../src/repo.ts";
import { findRegion } from "../src/rules-region.ts";

test("プロジェクト名と表示名は、ディレクトリ名から決まり、引数で上書きできる", () => {
  assert.equal(toPascalCase("jw-crew"), "JwCrew");
  const opts = parseInitArgs(["/tmp/my-project"]);
  assert.deepEqual([opts.name, opts.title, opts.filesOnly], ["my-project", "MyProject", false]);
  const custom = parseInitArgs(["/tmp/dir", "--name", "jwcrew", "--title", "JwCrew", "--summary", "概要", "--files-only"]);
  assert.deepEqual([custom.name, custom.title, custom.summary, custom.filesOnly], ["jwcrew", "JwCrew", "概要", true]);
  assert.throws(() => parseInitArgs(["/tmp/dir", "--name", "!bad"]), /プロジェクト名には/);
  assert.throws(() => parseInitArgs(["a", "b"]), /複数/);
});

test("雛形の {{name}} などだけを置き換え、GitHub Actions の ${{ }} はそのまま残す", () => {
  const vars = { name: "app", title: "App", summary: "概要", region: "R" };
  assert.equal(renderTemplate("{{title}} ({{name}}) {{summary}}\n{{region}}", vars), "App (app) 概要\nR");
  assert.equal(renderTemplate("path: ${{ runner.temp }}/x {{unknown}}", vars), "path: ${{ runner.temp }}/x {{unknown}}");
});

test("雛形を書くと、autodev を呼ぶ設定と文書ができ、ゲートの速い検査がすべて通る", (t) => {
  let tools: string[];
  try {
    tools = requireToolNames(process.cwd());
  } catch {
    t.skip("devboard コマンドが無い環境では、ツール名と決定記録の検査を確かめない");
    return;
  }
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-init-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeInitFiles({ targetDir: dir, name: "sample-app", title: "SampleApp", summary: "概要", filesOnly: true });

  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string; scripts: Record<string, string> };
  assert.equal(pkg.name, "sample-app");
  assert.equal(pkg.scripts.check, "autodev check");
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.ok(!existsSync(join(dir, "tools", "harness")), "実行基盤のコードは写さない");
  for (const hook of ["pre-commit", "commit-msg", "pre-push"]) {
    assert.ok(lstatSync(join(dir, ".githooks", hook)).mode & 0o111, `${hook} は実行できる`);
    assert.match(readFileSync(join(dir, ".githooks", hook), "utf8"), /autodev hook/);
  }
  const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
  assert.ok(findRegion(agents), "共通の規約を管理される区画として入れる");
  for (const rel of ["AGENTS.md", "README.md", "docs/product.md", "package.json", ".autodev/eval/public/docs.json"]) {
    assert.doesNotMatch(readFileSync(join(dir, rel), "utf8"), /\{\{(name|title|summary|region)\}\}/, `${rel} に置き換え漏れが無い`);
  }

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const repo = loadRepo(dir);
  assert.deepEqual(checkGate(repo), []);
  assert.deepEqual(checkConventions(repo), []);
  assert.deepEqual(checkRules(repo), []);
  assert.deepEqual(checkDocs(repo, tools), []);
  assert.deepEqual(checkRecords(repo, (files) => lintDecisionFiles(files, dir)), []);
});

test("package.json があるディレクトリには書かない", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-init-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "package.json"), "{}");
  assert.throws(
    () => writeInitFiles({ targetDir: dir, name: "x", title: "X", summary: "x", filesOnly: true }),
    /すでに package.json がある/,
  );
});
