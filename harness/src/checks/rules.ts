// AGENTS.md の共通の規約の区画が、tools/harness/rules/common.md と同じかを検査する。
// 区画が無い（共通の規約をまだ使っていない）リポジトリは見ない。ここは devboard にも頼らないので、CI でも動く

import { findRegion } from "../rules-region.ts";
import type { Problem, Repo } from "../repo.ts";

export const COMMON_RULES_FILE = "tools/harness/rules/common.md";
const AGENTS_FILE = "AGENTS.md";

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
  const common = repo.read(COMMON_RULES_FILE);
  if (common === null) {
    return [
      {
        check: "stale-common-rules",
        file: AGENTS_FILE,
        message: `共通の規約の区画があるのに ${COMMON_RULES_FILE} が無い`,
      },
    ];
  }
  if (region.body === common.trimEnd()) return [];
  return [
    {
      check: "stale-common-rules",
      file: AGENTS_FILE,
      line: region.startLine + 1,
      message: `共通の規約の区画が ${COMMON_RULES_FILE} とずれている。区画は直接直さず、common.md を直して node tools/harness/src/rules-sync.ts で更新する`,
    },
  ];
}

// スキルの base/ にある共通の規約が、このプロジェクトのものと違うときの案内。違わない・比べられないときは null
export function staleAgainstBase(projectCommon: string | null, baseCommon: string | null): string | null {
  if (projectCommon === null || baseCommon === null) return null;
  if (projectCommon.trimEnd() === baseCommon.trimEnd()) return null;
  return "共通の規約が、init-autodev スキルの base/ のものと違う。base/ が新しければ、node tools/harness/src/rules-sync.ts --from <base/tools/harness/rules/common.md> で更新する（古ければ、この変更を base/ に反映する）";
}
