// コミット前のゲート。ルートの `pnpm check` から呼ぶ。
// 速い検査（評価の緩め、規約、記録、ドキュメント）を先に行い、通ったら lint・型チェック・テストを実行する。
//   autodev check            作業ツリーを検査する
//   autodev check --staged   index（コミットされる中身）を一時ディレクトリに写して検査する。pre-commit が使う

import { projectRoot } from "./project-root.ts";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkConventions } from "./checks/conventions.ts";
import { checkDocs } from "./checks/docs.ts";
import { checkGate } from "./checks/gate.ts";
import { checkRecords } from "./checks/records.ts";
import { checkRules, readCommonRules, staleAgainstCommon } from "./checks/rules.ts";
import { lintDecisionFiles, requireToolNames } from "./devboard-cli.ts";
import { withoutGitEnv } from "./env.ts";
import { loadRepo, type Problem, type Repo } from "./repo.ts";
import { LINKED_MODULES_ENV, snapshotIndex } from "./snapshot.ts";
import { cacheFile, environmentOf, gateKey, hashFiles, lookup, readEntries, recordPass } from "./gate-cache.ts";
import { formatTimings, runBuffered, runInherited, type Stage } from "./steps.ts";
import { TEST_BASE_ENV, testArgs } from "./test-scope.ts";

const ROOT = projectRoot();

export function formatProblem({ check, file, line, message }: Problem): string {
  return `${file}${line ? `:${line}` : ""}: [${check}] ${message}`;
}

// プロジェクトの共通の規約の区画が、autodev の最新と違うときだけ、案内を出す（ゲートは止めない）
function notifyIfBehindCommon(repo: Repo): void {
  const message = staleAgainstCommon(repo.read("AGENTS.md"), readCommonRules());
  if (message) console.log(`check: 注意: ${message}`);
}

// 結果の再利用を使うか。CI と --no-cache と AUTODEV_NO_CACHE では使わない
const useCache = () => !process.env.CI && !process.env.AUTODEV_NO_CACHE && !process.argv.includes("--no-cache");

// テストを絞る基点（AUTODEV_TEST_BASE）からの差分のファイル。基点の指定が無ければ空、差分を取れなければ null
function changedFromTestBase(dir: string, env: NodeJS.ProcessEnv): string[] | null {
  const base = env[TEST_BASE_ENV];
  if (!base) return [];
  const diff = spawnSync("git", ["diff", "--name-only", base], { cwd: dir, env, encoding: "utf8" });
  return diff.status === 0 ? diff.stdout.split("\n").filter(Boolean) : null;
}

// 終了コードを返す。lint と型チェックは、互いに関係しないので並列に回し、出力は lint、型チェックの順に表示する。テストは、そのあと
async function runGate(repo: Repo, dir: string, env: NodeJS.ProcessEnv): Promise<number> {
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

  const problems = await timed("速い検査", () => [
    ...checkGate(repo),
    ...checkConventions(repo),
    ...checkRecords(repo, (files) => lintDecisionFiles(files, dir)),
    ...checkDocs(repo, requireToolNames(dir)),
    ...checkRules(repo),
  ]);
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
  const hasGit = existsSync(join(dir, ".git"));
  const scope = testArgs(env, rootTest, hasGit, hasGit ? changedFromTestBase(dir, env) : []);
  const test = await timed("テスト", () => runInherited("pnpm", scope, options));
  if (test !== 0) return finish(test);

  if (file && key) recordPass(file, key, Date.now());
  console.log("check: すべて通った");
  notifyIfBehindCommon(repo);
  return finish(0);
}

// フックから呼ばれると GIT_ の環境変数を受け取る。index を読むにはそれが要るが、
// テストの中の git が本物のリポジトリを指さないように、子プロセスには渡さない（L-008）
const childEnv = withoutGitEnv(process.env);

if (process.argv.includes("--staged")) {
  const staged = snapshotIndex(ROOT);
  let code: number;
  try {
    console.log(`check: コミットされる中身（index）を ${staged.dir} に写して検査する`);
    code = await runGate(loadRepo(ROOT, staged), staged.dir, { ...childEnv, ...LINKED_MODULES_ENV });
  } finally {
    rmSync(staged.dir, { recursive: true, force: true });
  }
  process.exit(code);
} else {
  process.exit(await runGate(loadRepo(ROOT), ROOT, childEnv));
}
