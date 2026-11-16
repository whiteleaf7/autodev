// autodev コマンドの入口（bin/autodev.ts と src/commands.ts）を確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { resolveCommand } from "../src/commands.ts";

const BIN = join(import.meta.dirname, "../bin/autodev.ts");

test("サブコマンドを、動かすスクリプトと引数に分ける", () => {
  assert.deepEqual(resolveCommand(["check", "--staged"]), { ok: true, script: "harness/src/check.ts", runner: null, args: ["--staged"] });
  assert.deepEqual(resolveCommand(["hook", "pre-commit"]), { ok: true, script: "harness/src/hook.ts", runner: null, args: ["pre-commit"] });
  assert.deepEqual(resolveCommand(["windows"]), { ok: true, script: "verify/src/windows.swift", runner: "swift", args: [] }, "swift で動かすものは runner を持つ");
  assert.deepEqual(resolveCommand(["screenshot", "http://x", "a.png"]), {
    ok: true,
    script: "verify/src/screenshot.ts",
    runner: null,
    args: ["http://x", "a.png"],
  });
});

test("コマンドが無い・help は使い方を、知らないコマンドと組み込みの名前は失敗として返す", () => {
  for (const argv of [[], ["help"], ["--help"]]) {
    const r = resolveCommand(argv);
    assert.ok(!r.ok && r.help && r.message.includes("使い方"));
  }
  assert.ok(!resolveCommand(["nothing"]).ok);
  assert.ok(!resolveCommand(["toString"]).ok, "オブジェクトの組み込みの名前をコマンドとして扱わない");
});

test("autodev --help は使い方を出して 0 で終わり、知らないコマンドは 2 で終わる", () => {
  const help = spawnSync("node", [BIN, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /check\s+ゲート/);
  const unknown = spawnSync("node", [BIN, "nothing"], { encoding: "utf8" });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /使い方/);
});
