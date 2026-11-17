import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadIndexRepo, loadRepo, parseCatFileBatch } from "../src/repo.ts";

test("git cat-file --batch の出力を、指定の順に読み、無いものは null にする", () => {
  const output = Buffer.from("abc123 blob 5\nhello\n0000 blob 0\n\nspec missing\n");
  const read = parseCatFileBatch(output, ["HEAD:a", "HEAD:empty", "HEAD:gone"]);
  assert.equal(read.get("HEAD:a"), "hello");
  assert.equal(read.get("HEAD:empty"), "");
  assert.equal(read.get("HEAD:gone"), null);
});

test("基点のファイルを、まとめて読んでも 1 つずつ読んでも、同じ中身になる（日本語・空・改行入り）", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-repo-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "pkg", "test"), { recursive: true });
  writeFileSync(join(dir, "pkg", "package.json"), '{"name":"日本語"}\n');
  writeFileSync(join(dir, "pkg", "test", "a.test.ts"), "test('あ', () => {});\n\n\n");
  writeFileSync(join(dir, "pkg", "test", "empty.test.ts"), "");
  writeFileSync(join(dir, "README.md"), "# 読み物\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat: base");
  writeFileSync(join(dir, "pkg", "package.json"), '{"name":"変えた"}\n');

  const repo = loadRepo(dir);
  const base = repo.base!;
  assert.equal(base.read("pkg/package.json"), '{"name":"日本語"}\n', "作業ツリーの変更ではなく、基点の中身");
  assert.equal(base.read("pkg/test/a.test.ts"), "test('あ', () => {});\n\n\n");
  assert.equal(base.read("pkg/test/empty.test.ts"), "");
  assert.equal(base.read("README.md"), "# 読み物\n", "まとめて読まないものも、読める");
  assert.equal(base.read("pkg/missing.test.ts"), null);
  assert.equal(repo.read("pkg/package.json"), '{"name":"変えた"}\n', "いまの姿は作業ツリー");
});

test("index の姿は、作業ツリーではなくステージした中身を読み、ステージした削除を反映する", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-repo-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "test"));
  writeFileSync(join(dir, "test", "a.test.ts"), "基点\n");
  writeFileSync(join(dir, "test", "b.test.ts"), "消す\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat: base");
  writeFileSync(join(dir, "test", "a.test.ts"), "ステージした\n");
  git("add", "test/a.test.ts");
  writeFileSync(join(dir, "test", "a.test.ts"), "ステージしていない\n");
  git("rm", "-q", "test/b.test.ts");

  const repo = loadIndexRepo(dir);
  assert.deepEqual(repo.files, ["test/a.test.ts"]);
  assert.equal(repo.read("test/a.test.ts"), "ステージした\n");
  assert.equal(repo.read("test/b.test.ts"), null);
  assert.equal(repo.base?.read("test/b.test.ts"), "消す\n");
});
