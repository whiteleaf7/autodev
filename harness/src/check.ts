// コミット前のゲート。ルートの `pnpm check` から呼ぶ。
// 速い検査（評価の緩め、規約、記録、ドキュメント）を先に行い、通ったら lint・型チェック・テストを実行する。
//   autodev check            作業ツリーを検査する
//   autodev check --staged   index（コミットされる中身）を一時ディレクトリに写して検査する。pre-commit が使う

import { projectRoot } from "./project-root.ts";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { checkConventions } from "./checks/conventions.ts";
import { checkDocs } from "./checks/docs.ts";
import { checkGate } from "./checks/gate.ts";
import { checkRecords } from "./checks/records.ts";
import { checkRules, readCommonRules, staleAgainstCommon } from "./checks/rules.ts";
import { lintDecisionFiles, requireToolNames } from "./devboard-cli.ts";
import { withoutGitEnv } from "./env.ts";
import { loadRepo, type Problem, type Repo } from "./repo.ts";
import { LINKED_MODULES_ENV, snapshotIndex } from "./snapshot.ts";

const ROOT = projectRoot();

export function formatProblem({ check, file, line, message }: Problem): string {
  return `${file}${line ? `:${line}` : ""}: [${check}] ${message}`;
}

// プロジェクトの共通の規約の区画が、autodev の最新と違うときだけ、案内を出す（ゲートは止めない）
function notifyIfBehindCommon(repo: Repo): void {
  const message = staleAgainstCommon(repo.read("AGENTS.md"), readCommonRules());
  if (message) console.log(`check: 注意: ${message}`);
}

// 終了コードを返す
function runGate(repo: Repo, dir: string, env: NodeJS.ProcessEnv): number {
  const problems = [
    ...checkGate(repo),
    ...checkConventions(repo),
    ...checkRecords(repo, (files) => lintDecisionFiles(files, dir)),
    ...checkDocs(repo, requireToolNames(dir)),
    ...checkRules(repo),
  ];
  if (problems.length) {
    for (const problem of problems) console.error(formatProblem(problem));
    console.error(
      `\n${problems.length} 件の問題がある。直してから、もう一度 pnpm check を実行する（lint・型チェック・テストは、これが通ってから走る）`,
    );
    return 1;
  }
  for (const script of ["lint", "typecheck", "test"]) {
    const { status } = spawnSync("pnpm", [script], { cwd: dir, stdio: "inherit", env });
    if (status !== 0) return status ?? 1;
  }
  console.log("check: すべて通った");
  notifyIfBehindCommon(repo);
  return 0;
}

// フックから呼ばれると GIT_ の環境変数を受け取る。index を読むにはそれが要るが、
// テストの中の git が本物のリポジトリを指さないように、子プロセスには渡さない（L-008）
const childEnv = withoutGitEnv(process.env);

if (process.argv.includes("--staged")) {
  const staged = snapshotIndex(ROOT);
  let code: number;
  try {
    console.log(`check: コミットされる中身（index）を ${staged.dir} に写して検査する`);
    code = runGate(loadRepo(ROOT, staged), staged.dir, { ...childEnv, ...LINKED_MODULES_ENV });
  } finally {
    rmSync(staged.dir, { recursive: true, force: true });
  }
  process.exit(code);
} else {
  process.exit(runGate(loadRepo(ROOT), ROOT, childEnv));
}
