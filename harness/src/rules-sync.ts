// AGENTS.md の共通の規約の区画を、autodev の共通の規約（harness/rules/common.md）の最新で作り直す。
//   autodev rules-sync
// 区画の外（プロジェクト固有の記述）は変えない。AGENTS.md に区画が無いときは、区画を置く場所に始まりと終わりの行を書く

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCommonRules } from "./checks/rules.ts";
import { projectRoot } from "./project-root.ts";
import { replaceRegion } from "./rules-region.ts";

export function syncRules(root: string): string {
  const agentsPath = join(root, "AGENTS.md");
  const next = replaceRegion(readFileSync(agentsPath, "utf8"), readCommonRules());
  if (next === null) {
    throw new Error(
      "AGENTS.md に共通の規約の区画が無い。共通の規約を置く場所に、<!-- autodev:common:start --> と <!-- autodev:common:end --> の 2 行を書いてから、もう一度実行する",
    );
  }
  writeFileSync(agentsPath, next);
  return agentsPath;
}

if (import.meta.main) {
  try {
    console.log(`rules-sync: ${syncRules(projectRoot())} の共通の規約の区画を更新した`);
  } catch (e) {
    console.error(`rules-sync: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
