// AGENTS.md の共通の規約の区画を、tools/harness/rules/common.md の中身で書き換える。
//   node tools/harness/src/rules-sync.ts                       このプロジェクトの common.md から区画を作り直す
//   node tools/harness/src/rules-sync.ts --from <common.md>    先に、このプロジェクトの common.md を <common.md> の中身にしてから、区画を作り直す
//                                                               （init-autodev スキルの base/ からの update）

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { COMMON_RULES_FILE } from "./checks/rules.ts";
import { replaceRegion } from "./rules-region.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

export function syncRules(root: string, from?: string): string {
  const commonPath = join(root, COMMON_RULES_FILE);
  if (from) {
    if (!existsSync(from)) throw new Error(`${from} が無い`);
    mkdirSync(dirname(commonPath), { recursive: true });
    copyFileSync(from, commonPath);
  }
  if (!existsSync(commonPath)) throw new Error(`${COMMON_RULES_FILE} が無い。--from <common.md> で渡す`);
  const agentsPath = join(root, "AGENTS.md");
  const next = replaceRegion(readFileSync(agentsPath, "utf8"), readFileSync(commonPath, "utf8"));
  if (next === null) {
    throw new Error(
      "AGENTS.md に共通の規約の区画が無い。区画の始まりと終わりの行を、共通の規約を置く場所に書く（init-autodev の base/ の雛形を参照）",
    );
  }
  writeFileSync(agentsPath, next);
  return agentsPath;
}

if (import.meta.main) {
  try {
    const fromIndex = process.argv.indexOf("--from");
    const from =
      fromIndex >= 0 ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[fromIndex + 1] ?? "") : undefined;
    console.log(`rules-sync: ${syncRules(ROOT, from)} の共通の規約の区画を更新した`);
  } catch (e) {
    console.error(`rules-sync: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
