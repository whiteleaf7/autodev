// コミット前のゲート。ルートの `pnpm check` から呼ぶ。
// 速い検査（評価の緩め、規約、記録、ドキュメント）を先に行い、通ったら lint・型チェック・テストを実行する。
//   autodev check            作業ツリーを検査する
//   autodev check --staged   index（コミットされる中身）を一時ディレクトリに写して検査する。pre-commit が使う

import { projectRoot } from "./project-root.ts";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gateModes, splitByMode } from "./check-modes.ts";
import { checkConventions } from "./checks/conventions.ts";
import { checkDocs } from "./checks/docs.ts";
import { checkGate, REMOVED_TEST } from "./checks/gate.ts";
import { checkRecords } from "./checks/records.ts";
import { checkRules, readCommonRules, staleAgainstCommon } from "./checks/rules.ts";
import { lintDecisionFiles, requireToolNames } from "./devboard-cli.ts";
import { withoutGitEnv } from "./env.ts";
import { formatProblem, loadRepo, type Repo } from "./repo.ts";
import { LINKED_MODULES_ENV, snapshotIndex } from "./snapshot.ts";
import { cacheFile, environmentOf, gateKey, hashFiles, lookup, readEntries, recordPass } from "./gate-cache.ts";
import { logFindings } from "./gate-log.ts";
import { formatTimings, runBuffered, runInherited, type Stage } from "./steps.ts";
import { testArgs } from "./test-scope.ts";

const ROOT = projectRoot();

// プロジェクトの共通の規約の区画が、autodev の最新と違うときだけ、案内を出す（ゲートは止めない）
function notifyIfBehindCommon(repo: Repo): void {
  const message = staleAgainstCommon(repo.read("AGENTS.md"), readCommonRules());
  if (message) console.log(`check: 注意: ${message}`);
}

// 結果の再利用を使うか。CI と --no-cache と AUTODEV_NO_CACHE では使わない
const useCache = () => !process.env.CI && !process.env.AUTODEV_NO_CACHE && !process.argv.includes("--no-cache");

// 終了コードを返す。lint と型チェックは、互いに関係しないので並列に回し、出力は lint、型チェックの順に表示する。テストは、そのあと。
// staged（pre-commit）では、テストの減りを止めずに commit-msg へ回す。消した理由はコミットの本文に書くが、pre-commit からは本文が見えない
async function runGate(repo: Repo, dir: string, env: NodeJS.ProcessEnv, staged: boolean): Promise<number> {
  const stages: Stage[] = [];
  const timed = async <T>(name: string, work: () => Promise<T> | T): Promise<T> => {
    const started = performance.now();
    try {
      return await work();
    } finally {
      stages.push({ name, ms: performance.now() - started });
    }
  };
  const finish = (code: number): number => {
    console.log(formatTimings(stages));
    return code;
  };

  const { blocking: problems, observed } = await timed("速い検査", () => {
    const modes = gateModes(repo);
    return splitByMode(
      [
        ...modes.problems,
        ...checkGate(repo).filter((problem) => !(staged && problem.check === REMOVED_TEST)),
        ...checkConventions(repo),
        ...checkRecords(repo, (files) => lintDecisionFiles(files, dir)),
        ...checkDocs(repo, requireToolNames(dir)),
        ...checkRules(repo),
      ],
      modes.modeOf,
    );
  });
  logFindings(ROOT, { observed, blocking: problems });
  for (const problem of observed) console.log(`check: 記録だけ（observe）: ${formatProblem(problem)}`);
  if (observed.length) console.log(`check: observe の ${observed.length} 件は止めない。記録は autodev gate-log で見る`);
  if (problems.length) {
    for (const problem of problems) console.error(formatProblem(problem));
    console.error(
      `\n${problems.length} 件の問題がある。直してから、もう一度 pnpm check を実行する（lint・型チェック・テストは、これが通ってから走る）`,
    );
    return finish(1);
  }

  // 同じ中身を、すでに通している（手での check、コミットの pre-commit、land）なら、lint・型チェック・テストは飛ばす。CI は、いつも全部を回す
  const file = useCache() ? cacheFile(ROOT) : null;
  const key = file ? await timed("鍵の計算", () => gateKey(hashFiles(dir, repo.files), environmentOf())) : null;
  const passed = file && key ? lookup(readEntries(file, Date.now()), key) : undefined;
  if (passed) {
    console.log(
      `check: lint・型チェック・テストは、同じ中身が ${new Date(passed.at).toLocaleString("ja-JP")} に通っているので飛ばした（回すときは autodev check --no-cache）`,
    );
    console.log("check: すべて通った");
    notifyIfBehindCommon(repo);
    return finish(0);
  }

  const options = { cwd: dir, env };
  const [lint, typecheck] = await timed("lint・型チェック（並列）", () =>
    Promise.all([runBuffered("pnpm", ["lint"], options), runBuffered("pnpm", ["typecheck"], options)]),
  );
  for (const result of [lint, typecheck]) process.stdout.write(result.output);
  if (lint.status !== 0 || typecheck.status !== 0) return finish(lint.status !== 0 ? lint.status : typecheck.status);

  const rootTest = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: { test?: string } })
    .scripts?.test;
  const test = await timed("テスト", () =>
    runInherited("pnpm", testArgs(env, rootTest, existsSync(join(dir, ".git"))), options),
  );
  if (test !== 0) return finish(test);

  if (file && key) recordPass(file, key, Date.now());
  console.log("check: すべて通った");
  notifyIfBehindCommon(repo);
  return finish(0);
}

// フックから呼ばれると GIT_ の環境変数を受け取る。index を読むにはそれが要るが、
// テストの中の git が本物のリポジトリを指さないように、子プロセスには渡さない（L-008）
const childEnv = withoutGitEnv(process.env);

async function main(): Promise<number> {
  if (!process.argv.includes("--staged")) return runGate(loadRepo(ROOT), ROOT, childEnv, false);
  const staged = snapshotIndex(ROOT);
  try {
    console.log(`check: コミットされる中身（index）を ${staged.dir} に写して検査する`);
    return await runGate(loadRepo(ROOT, staged), staged.dir, { ...childEnv, ...LINKED_MODULES_ENV }, true);
  } finally {
    rmSync(staged.dir, { recursive: true, force: true });
  }
}

// 検査を回せなかった理由（devboard が無い、外のプロセスが終わらないなど）は、スタックではなく直し方の言葉で出す
try {
  process.exit(await main());
} catch (e) {
  console.error(`check: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
