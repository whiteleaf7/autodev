import { test } from "node:test";
import assert from "node:assert/strict";
import { type CoveringJob, type Finding, reviewReport } from "../src/review-findings.ts";

const a = { sha: "a".repeat(40), subject: "feat: add a" };
const b = { sha: "b".repeat(40), subject: "fix: b" };
const job = (id: number, covers: string[], rest: Partial<CoveringJob> = {}): CoveringJob => ({
  id,
  git_ref: covers.join(".."),
  status: "done",
  closed: false,
  verdict: "F",
  covers,
  ...rest,
});
const finding = (severity: string, problem = `${severity} problem`): Finding => ({
  severity,
  problem,
  location: "src/x.ts:1",
});

test("High が開いたままなら止め、job の ID と閉じ方を出す", () => {
  const report = reviewReport([a], [job(129, [a.sha])], new Map([[129, [finding("high"), finding("low")]]]));
  assert.equal(report.blocked, true);
  const text = report.lines.join("\n");
  assert.match(text, /High の指摘が開いたまま/);
  assert.match(text, /job 129（aaaaaaa feat: add a） high src\/x\.ts:1: high problem/);
  assert.match(text, /Medium・Low の指摘（表示だけ）:\n {2}- job 129.* low/);
  assert.match(text, /roborev job comment --job <id>/);
  assert.match(text, /roborev job close <id>/);
});

test("Critical も High と同じく止める", () => {
  assert.equal(reviewReport([a], [job(1, [a.sha])], new Map([[1, [finding("Critical")]]])).blocked, true);
});

test("Medium・Low だけなら、表示して通す", () => {
  const report = reviewReport([a], [job(5, [a.sha])], new Map([[5, [finding("medium")]]]));
  assert.equal(report.blocked, false);
  assert.match(report.lines.join("\n"), /Medium・Low/);
  assert.doesNotMatch(report.lines.join("\n"), /roborev job close/);
});

test("閉じた job と、通った job の指摘は見ない", () => {
  const report = reviewReport(
    [a, b],
    [job(1, [a.sha], { closed: true }), job(2, [b.sha], { verdict: "P" })],
    new Map([[1, [finding("high")]]]),
  );
  assert.deepEqual(report, { blocked: false, lines: [] });
});

test("ほかのブランチのコミットの job は見ない", () => {
  const report = reviewReport(
    [a],
    [job(1, [a.sha], { verdict: "P" }), job(9, ["c".repeat(40)])],
    new Map([[9, [finding("high")]]]),
  );
  assert.equal(report.blocked, false);
});

test("範囲をまとめてレビューした job の指摘は、範囲のコミットのものとして扱う", () => {
  const report = reviewReport([a, b], [job(7, [a.sha, b.sha])], new Map([[7, [finding("high")]]]));
  assert.equal(report.blocked, true);
  assert.match(report.lines.join("\n"), /job 7（aaaaaaa feat: add a、bbbbbbb fix: b）/);
});

test("指摘の形が読めない F の job は、黙って通さずに止める", () => {
  const report = reviewReport([a], [job(3, [a.sha])], new Map([[3, null]]));
  assert.equal(report.blocked, true);
  assert.match(report.lines.join("\n"), /形が読めない[\s\S]*job 3/);
});

test("終わっていないレビューと、積まれていないコミットは、止めずにそう出す", () => {
  const report = reviewReport([a, b], [job(4, [a.sha], { status: "running", verdict: null })], new Map());
  assert.equal(report.blocked, false);
  const text = report.lines.join("\n");
  assert.match(text, /まだ終わっていない[^\n]*\n {2}- aaaaaaa feat: add a/);
  assert.match(text, /積まれていない[^\n]*\n {2}- bbbbbbb fix: b/);
});

test("失敗したレビューしか無いコミットは、積まれていないものとして出す", () => {
  const report = reviewReport([a], [job(6, [a.sha], { status: "failed", verdict: null })], new Map());
  assert.match(report.lines.join("\n"), /積まれていない[^\n]*\n {2}- aaaaaaa/);
});

test("長い指摘は 1 行に縮めて切る", () => {
  const long = `一行目\n${"あ".repeat(300)}`;
  const report = reviewReport([a], [job(8, [a.sha])], new Map([[8, [finding("high", long)]]]));
  const line = report.lines.find((l) => l.includes("job 8")) ?? "";
  assert.ok(!line.includes("\n"));
  assert.ok(line.endsWith("…"));
});
