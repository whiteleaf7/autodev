// 評価で、同じ検査を何度もやり直さないための、シナリオの並べ方。
// ゲートの結果の使い回し（gate-cache.ts）は、同じ中身が先に通っていないと効かない。同じ中身のシナリオを最初の 5 並列で同時に回すと、
// 全部が空振りするので、同じ中身の 2 件目以降は、1 件目が終わったあとに回す

import type { Scenario } from "./scenario.ts";

type Work = Pick<Scenario, "kind" | "board" | "commit" | "edits">;

// 同じ中身の検査になるシナリオは、同じ鍵になる。ゲートを回さないもの（query・board）は null
export function sameWorkKey(s: Work): string | null {
  if (s.kind === "query" || s.board.length) return null;
  if (s.commit) {
    // コミットされる中身（index）で検査されるので、ステージしないファイルの編集は、結果に関わらない
    const staged = [...s.commit.stage].sort();
    return `commit:${JSON.stringify(staged.map((file) => [file, s.edits.filter((e) => e.file === file)]))}`;
  }
  return `gate:${JSON.stringify(s.edits)}`;
}

// 先に回す番号と、あとに回す番号（同じ鍵の 2 件目以降）。どちらも元の並びを保つ
export function phasesOf<T>(items: T[], key: (item: T) => string | null): [number[], number[]] {
  const seen = new Set<string>();
  const first: number[] = [];
  const later: number[] = [];
  items.forEach((item, index) => {
    const k = key(item);
    if (k !== null && seen.has(k)) later.push(index);
    else {
      if (k !== null) seen.add(k);
      first.push(index);
    }
  });
  return [first, later];
}
