import assert from "node:assert/strict";
import { test } from "node:test";
import { phasesOf, sameWorkKey } from "../src/eval-order.ts";

const note = { file: "docs/note.md", write: "a" };
const gate = (edits: { file: string; write: string }[]) => ({ kind: "bad" as const, board: [], edits });
const commit = (stage: string[], edits: { file: string; write: string }[]) => ({
  kind: "bad" as const,
  board: [],
  edits,
  commit: { message: "m", stage },
});

test("同じ中身がコミットされるシナリオは、メッセージやステージしない編集が違っても、同じ鍵になる", () => {
  const a = sameWorkKey(commit(["docs/note.md"], [note]));
  const b = sameWorkKey(commit(["docs/note.md"], [note, { file: "src/x.ts", write: "unstaged" }]));
  assert.equal(a, b);
  assert.notEqual(a, sameWorkKey(commit(["docs/note.md"], [{ file: "docs/note.md", write: "b" }])));
});

test("ゲートを回さないシナリオ（query・board）は鍵が無く、ゲートとコミットは別の鍵になる", () => {
  assert.equal(sameWorkKey({ kind: "query", board: [], edits: [] }), null);
  assert.equal(sameWorkKey({ kind: "bad", board: [{ op: "x" }] as never, edits: [] }), null);
  assert.notEqual(sameWorkKey(gate([note])), sameWorkKey(commit(["docs/note.md"], [note])));
});

test("同じ鍵の 2 件目以降だけをあとに回し、鍵が無いものは先に回す。どちらも元の並びを保つ", () => {
  const keys = ["a", null, "a", "b", "a", null, "b"];
  assert.deepEqual(phasesOf(keys, (k) => k), [[0, 1, 3, 5], [2, 4, 6]]);
});
