import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TTL_MS, cacheFile, gateKey, hashFiles, lookup, parseEntries, readEntries, recordPass } from "../src/gate-cache.ts";

const files = [
  { path: "a.ts", hash: "1" },
  { path: "b/c.ts", hash: "2" },
];

test("同じ中身と環境なら同じ鍵で、並びには左右されない", () => {
  const key = gateKey(files, ["node-26", "darwin"]);
  assert.equal(gateKey([...files].reverse(), ["node-26", "darwin"]), key);
  assert.match(key, /^[0-9a-f]{64}$/);
});

test("1 つでも、中身・パス・ファイルの数・環境が変われば、鍵が変わる", () => {
  const key = gateKey(files, ["node-26"]);
  assert.notEqual(gateKey([{ path: "a.ts", hash: "changed" }, files[1]!], ["node-26"]), key, "中身");
  assert.notEqual(gateKey([{ path: "renamed.ts", hash: "1" }, files[1]!], ["node-26"]), key, "パス");
  assert.notEqual(gateKey([files[0]!], ["node-26"]), key, "ファイルの数");
  assert.notEqual(gateKey(files, ["node-27"]), key, "環境");
  // パスと中身の境目が曖昧で、別の組が同じ鍵にならない
  assert.notEqual(gateKey([{ path: "a", hash: "bc" }], []), gateKey([{ path: "ab", hash: "c" }], []));
});

test("hashFiles は、中身のハッシュを返し、読めないものは印を付ける", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-cache-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "x.txt"), "中身");
  const [x, gone] = hashFiles(dir, ["x.txt", "missing.txt"]);
  assert.match(x!.hash, /^[0-9a-f]{64}$/);
  assert.equal(gone!.hash, "unreadable");
  writeFileSync(join(dir, "x.txt"), "中身を変えた");
  assert.notEqual(hashFiles(dir, ["x.txt"])[0]!.hash, x!.hash);
});

test("記録は、7 日で切れ、壊れていても空として読む", () => {
  const now = 10 * TTL_MS;
  const text = JSON.stringify([
    { key: "old", at: now - TTL_MS - 1 },
    { key: "fresh", at: now - 1000 },
    { key: 1, at: now },
    "not-an-entry",
  ]);
  assert.deepEqual(parseEntries(text, now).map((e) => e.key), ["fresh"]);
  assert.deepEqual(parseEntries("これは JSON ではない", now), []);
  assert.deepEqual(parseEntries('{"not":"an array"}', now), []);
  assert.deepEqual(parseEntries(null, now), []);
});

test("通過を記録すると、同じ鍵を引ける。同じ鍵の記録は 1 つに保ち、古いものから 50 件に切る", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-cache-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "sub", "cache.json");
  assert.deepEqual(readEntries(file, 1000), [], "ファイルが無い");
  recordPass(file, "k1", 1000);
  assert.equal(lookup(readEntries(file, 1000), "k1")?.at, 1000);
  assert.equal(lookup(readEntries(file, 1000), "other"), undefined);
  recordPass(file, "k1", 2000);
  assert.equal(readEntries(file, 2000).filter((e) => e.key === "k1").length, 1);
  for (let i = 0; i < 60; i++) recordPass(file, `n${i}`, 3000 + i);
  const entries = readEntries(file, 4000);
  assert.equal(entries.length, 50);
  assert.equal(lookup(entries, "k1"), undefined, "古いものから落ちる");
  assert.ok(lookup(entries, "n59"));
  assert.doesNotThrow(() => JSON.parse(readFileSync(file, "utf8")));
});

test("記録の置き場所は、git の共通のディレクトリで、worktree の間で共有される。git でなければ null", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "autodev-cache-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(cacheFile(dir), null, "git のリポジトリではない");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  const main = join(dir, "main");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(main, "commit", "-q", "--allow-empty", "-m", "chore: first");
  const linked = join(dir, "linked");
  git(main, "worktree", "add", "-q", "-b", "other", linked);
  const fromMain = cacheFile(main);
  assert.equal(fromMain, join(main, ".git", "autodev-gate-cache.json"));
  assert.equal(cacheFile(linked), fromMain, "linked worktree も、同じ場所");
});
