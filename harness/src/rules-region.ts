// AGENTS.md の中の「管理される区画」。共通の規約（autodev の harness/rules/common.md）を、プロジェクトごとの固有の記述と分けて持つ。
// 区画の始まりの行に、中身の短いハッシュ（sha=）を記録する。区画を直接直すと、ハッシュと合わなくなり、ゲートが止める。
// 共通の規約を新しくしたときは、ハッシュの違いから、プロジェクトの区画が古いことが分かる。更新は autodev rules-sync

import { createHash } from "node:crypto";

export const REGION_START_PREFIX = "<!-- autodev:common:start";
export const REGION_END = "<!-- autodev:common:end -->";

export const commonSha = (common: string): string =>
  createHash("sha256").update(common.trimEnd()).digest("hex").slice(0, 12);

const startLine = (sha: string) =>
  `${REGION_START_PREFIX} sha=${sha}（autodev の共通の規約から作られる。直接は直さず、autodev rules-sync で更新する） -->`;

export function renderRegion(common: string): string {
  return `${startLine(commonSha(common))}\n${common.trimEnd()}\n${REGION_END}`;
}

export type Region = { startLine: number; endLine: number; body: string; recordedSha: string | null };

// 区画が無ければ null。始まりだけ・終わりだけ・順序の逆は、壊れた区画として例外にする
export function findRegion(text: string): Region | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(REGION_START_PREFIX));
  const end = lines.findIndex((line) => line.trim() === REGION_END);
  if (start < 0 && end < 0) return null;
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`区画の始まり（${REGION_START_PREFIX} …）と終わり（${REGION_END}）が、この順に 1 組そろっていない`);
  }
  const recordedSha = /\bsha=([0-9a-f]{12})\b/.exec(lines[start] ?? "")?.[1] ?? null;
  return { startLine: start, endLine: end, body: lines.slice(start + 1, end).join("\n"), recordedSha };
}

// 区画の中身を common で置き換えた文書を返す。区画が無ければ null
export function replaceRegion(text: string, common: string): string | null {
  const region = findRegion(text);
  if (!region) return null;
  const lines = text.split("\n");
  return [...lines.slice(0, region.startLine), renderRegion(common), ...lines.slice(region.endLine + 1)].join("\n");
}
