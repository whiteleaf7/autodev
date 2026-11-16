// AGENTS.md の共通の規約の区画を検査する。
// - 区画の中身が、始まりの行に記録したハッシュと合うこと（区画を直接直す抜け道を塞ぐ）。区画が無い AGENTS.md は見ない
// - autodev の共通の規約が新しくなって、プロジェクトの区画が古いときは、案内だけを出す（止めない。新しい規約で、無関係な変更の CI を止めないため）

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commonSha, findRegion } from "../rules-region.ts";
import type { Problem, Repo } from "../repo.ts";

const AGENTS_FILE = "AGENTS.md";

// 共通の規約の本文。autodev が持つ（プロジェクトにコピーを置かない）
export const COMMON_RULES_PATH = join(import.meta.dirname, "../../rules/common.md");
export const readCommonRules = (): string => readFileSync(COMMON_RULES_PATH, "utf8");

export function checkRules(repo: Repo): Problem[] {
  const agents = repo.read(AGENTS_FILE);
  if (agents === null) return [];
  let region;
  try {
    region = findRegion(agents);
  } catch (e) {
    return [{ check: "stale-common-rules", file: AGENTS_FILE, message: e instanceof Error ? e.message : String(e) }];
  }
  if (!region) return [];
  if (region.recordedSha !== null && region.recordedSha === commonSha(region.body)) return [];
  return [
    {
      check: "stale-common-rules",
      file: AGENTS_FILE,
      line: region.startLine + 1,
      message:
        "共通の規約の区画の中身が、記録したハッシュと合わない（直接直されたか、ハッシュが無い）。区画は直接直さず、autodev rules-sync で作り直す。固有の記述は、区画の外に書く",
    },
  ];
}

// プロジェクトの区画が、autodev の共通の規約の最新と違うときの案内。区画が無い・同じときは null
export function staleAgainstCommon(agents: string | null, common: string): string | null {
  if (agents === null) return null;
  let region;
  try {
    region = findRegion(agents);
  } catch {
    return null;
  }
  if (!region || region.recordedSha === commonSha(common)) return null;
  return "共通の規約が、autodev の最新と違う。autodev rules-sync で更新する（区画の外の固有の記述は変わらない）";
}
