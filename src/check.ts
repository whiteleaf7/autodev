// コミット前のゲート。ルートの `pnpm check` から呼ぶ。
// 速い検査（評価の緩め、規約、記録、ドキュメント）を先に行い、通ったら lint・型チェック・テストを実行する。

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { checkConventions } from "./checks/conventions.ts";
import { checkDocs } from "./checks/docs.ts";
import { checkGate } from "./checks/gate.ts";
import { checkRecords } from "./checks/records.ts";
import { loadRepo, type Problem } from "./repo.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

export function formatProblem({ check, file, line, message }: Problem): string {
  return `${file}${line ? `:${line}` : ""}: [${check}] ${message}`;
}

const repo = loadRepo(ROOT);
const problems = [...checkGate(repo), ...checkConventions(repo), ...checkRecords(repo), ...checkDocs(repo)];
if (problems.length) {
  for (const problem of problems) console.error(formatProblem(problem));
  console.error(
    `\n${problems.length} 件の問題がある。直してから、もう一度 pnpm check を実行する（lint・型チェック・テストは、これが通ってから走る）`,
  );
  process.exit(1);
}

for (const script of ["lint", "typecheck", "test"]) {
  const { status } = spawnSync("pnpm", [script], { cwd: ROOT, stdio: "inherit" });
  if (status !== 0) process.exit(status ?? 1);
}
console.log("check: すべて通った");
