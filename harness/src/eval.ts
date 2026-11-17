// ハーネス評価のランナー。シナリオを作業ツリーの複製に当て、ゲートが止めるかを数える。
//   node src/eval.ts [--set public|heldout] [--family <名前>] [--record] [--validate]
// heldout は集計だけを出す（改善する側が中身を知らないことが、最終評価の前提のため）。

import { projectRoot } from "./project-root.ts";
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { snapshotBoard } from "./devboard-cli.ts";
import { loadScenarios, type Scenario } from "./scenario.ts";
import { applyEdits, cloneTemplate, createTemplate, removeDir, run } from "./sandbox.ts";
import { formatSummary, summarize, type Outcome, type Result } from "./score.ts";
import { runDir, sweepStaleRunDirs } from "./run-dir.ts";
import { TEST_SCOPE_ENV } from "./test-scope.ts";
import { evalCacheFile } from "./gate-cache.ts";
import { phasesOf, sameWorkKey } from "./eval-order.ts";

const ROOT = projectRoot();
const RECALL_TOP = 3;

// ゲートのコマンドは、編集を当てる前のリポジトリが決める（ゲート自体を消す編集で、基準が緩まないように）
function gateCommand(): string {
  const { scripts = {} } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return "check" in scripts ? "pnpm check" : "pnpm typecheck && pnpm test";
}

// ボードは git の外の SQLite にある（決定記録 0011）。いまのボードの写しを 1 つ取り、シナリオごとにそれを複製して渡す
function takeBoardSnapshot(): string {
  const file = join(mkdtempSync(join(runDir(), "board-")), "board.sqlite");
  snapshotBoard(file, ROOT);
  return file;
}

async function judge(
  scenario: Scenario,
  template: string,
  gate: string,
  boardSnapshot: string,
  cacheEnv: NodeJS.ProcessEnv,
): Promise<Result> {
  const dir = cloneTemplate(template);
  // 複製の外に置く（複製の中だと、ゲートが追跡していないファイルとして読む）
  const boardFile = `${dir}.board.sqlite`;
  copyFileSync(boardSnapshot, boardFile);
  // シナリオのコミットで .githooks/post-commit が roborev のレビューを積まないように
  const env = { DEVBOARD_DB: boardFile, HARNESS_SKIP_REVIEW: "1", ...cacheEnv };
  try {
    const problem = applyEdits(dir, scenario.edits);
    if (problem) return { scenario, outcome: "inapplicable", detail: problem };

    if (scenario.kind === "query") {
      const { code, output } = await run("pnpm", ["--silent", "recall", "--json", scenario.query ?? ""], dir, env);
      const ids = code === 0 ? topIds(output) : [];
      const hit = (scenario.expect ?? []).some((id) => ids.includes(id));
      return { scenario, outcome: hit ? "hit" : "no-hit", detail: ids.join(", ") };
    }

    const { code, output } = scenario.board.length
      ? await run("devboard", ["apply", JSON.stringify(scenario.board)], dir, env)
      : scenario.commit
        ? await commit(dir, scenario.commit, env)
        : await run("sh", ["-c", gate], dir, { ...env, [TEST_SCOPE_ENV]: "changed" });
    const stopped = code !== 0;
    const outcome: Outcome =
      scenario.kind === "bad" ? (stopped ? "caught" : "missed") : stopped ? "false-alarm" : "passed";
    return { scenario, outcome, detail: stopped ? lastLines(output) : "" };
  } finally {
    removeDir(dir);
    for (const suffix of ["", "-wal", "-shm"]) removeDir(boardFile + suffix);
  }
}

async function commit(dir: string, { message, stage }: NonNullable<Scenario["commit"]>, env: NodeJS.ProcessEnv) {
  if (existsSync(join(dir, ".githooks"))) await run("git", ["config", "core.hooksPath", ".githooks"], dir);
  const added = await run("git", ["add", "-f", "--", ...stage], dir);
  if (added.code !== 0) return added;
  return run("git", ["commit", "-m", message], dir, env);
}

function topIds(output: string): string[] {
  try {
    const results: unknown = (JSON.parse(output) as { results?: unknown }).results;
    if (!Array.isArray(results)) return [];
    return (results as ({ id?: unknown } | null)[]).slice(0, RECALL_TOP).map((r) => {
      const id = r?.id;
      return typeof id === "string" || typeof id === "number" ? String(id) : "";
    });
  } catch {
    return [];
  }
}

const lastLines = (text: string) => text.trim().split("\n").slice(-4).join(" | ").slice(0, 400);

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]!);
      }
    }),
  );
  return results;
}

// 複製のゲートが使う、結果の使い回しの設定。評価の全体で 1 つの記録を共有し、実行をまたいでも残す（複製ごとの .git に書くと捨てられる）。
// 鍵に基点の中身（複製の元のツリー）を入れるので、リポジトリの中身が変われば、前の実行の記録は使われない。
// --no-cache と CI では使わない。--record（最終評価の記録）は、実行をまたいで使い回さず、この実行の中だけで共有する
async function gateCacheEnv(template: string): Promise<NodeJS.ProcessEnv> {
  if (values["no-cache"] || process.env.CI) return { AUTODEV_NO_CACHE: "1" };
  const file = values.record
    ? join(mkdtempSync(join(runDir(), "cache-")), "cache.json")
    : evalCacheFile(ROOT);
  if (!file) return { AUTODEV_NO_CACHE: "1" };
  const { output } = await run("git", ["rev-parse", "HEAD^{tree}"], template);
  return { AUTODEV_GATE_CACHE_FILE: file, AUTODEV_GATE_CACHE_SALT: output.trim() };
}

// シナリオが、いまのリポジトリに当てられる形かだけを確かめる（中身は出さない）
function validate(scenarios: Scenario[], template: string): number {
  let broken = 0;
  for (const scenario of scenarios) {
    const dir = cloneTemplate(template);
    const problem = applyEdits(dir, scenario.edits);
    removeDir(dir);
    if (problem) {
      broken++;
      console.log(`${scenario.id}: ${problem.replace(/^.*?: /, "")}`);
    }
  }
  console.log(`${scenarios.length} 件中 ${broken} 件が当てられない`);
  return broken;
}

const { values } = parseArgs({
  options: {
    set: { type: "string", default: "public" },
    family: { type: "string" },
    record: { type: "boolean", default: false },
    validate: { type: "boolean", default: false },
    "no-cache": { type: "boolean", default: false },
  },
});
if (values.set !== "public" && values.set !== "heldout") throw new Error("--set は public か heldout");

const scenarios = loadScenarios(join(ROOT, ".autodev/eval", values.set)).filter(
  (s) => !values.family || s.family === values.family,
);
sweepStaleRunDirs();
const template = createTemplate(ROOT);
const boardSnapshot = takeBoardSnapshot();
try {
  if (values.validate) {
    process.exitCode = validate(scenarios, template) ? 1 : 0;
  } else {
    const gate = gateCommand();
    const cacheEnv = await gateCacheEnv(template);
    const size = Math.max(2, Math.floor(availableParallelism() / 2));
    // 同じ中身の検査は、1 件目が通ったあとに回し、ゲートの結果の使い回しを効かせる
    const results: Result[] = [];
    for (const indices of phasesOf(scenarios, sameWorkKey)) {
      const done = await pool(
        indices.map((i) => scenarios[i]!),
        size,
        (s) => judge(s, template, gate, boardSnapshot, cacheEnv),
      );
      indices.forEach((index, n) => {
        results[index] = done[n]!;
      });
    }
    const summary = summarize(results);
    if (values.set === "public") {
      for (const r of results)
        console.log(
          `[${r.outcome}] ${r.scenario.id} ${r.scenario.class}: ${r.scenario.title}${r.detail ? `\n    ${r.detail}` : ""}`,
        );
    }
    console.log(`\n${values.set}（ゲート: ${gate}）`);
    console.log(formatSummary(summary));
    if (values.record) {
      const commitHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
      mkdirSync(join(ROOT, ".autodev"), { recursive: true });
      appendFileSync(
        join(ROOT, ".autodev/history.jsonl"),
        JSON.stringify({ at: new Date().toISOString(), set: values.set, commit: commitHash, gate, ...summary }) + "\n",
      );
    }
  }
} finally {
  removeDir(template);
  removeDir(resolve(boardSnapshot, ".."));
}
