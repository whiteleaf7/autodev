// ハーネス評価のランナー。シナリオを作業ツリーの複製に当て、ゲートが止めるかを数える。
//   node src/eval.ts [--set public|heldout] [--family <名前>] [--record] [--validate]
// heldout は集計だけを出す（改善する側が中身を知らないことが、最終評価の前提のため）。

import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { board } from "@nagaya/devboard/src/board-db.ts";
import { loadScenarios, type Scenario } from "./scenario.ts";
import { applyEdits, cloneTemplate, createTemplate, removeDir, run } from "./sandbox.ts";
import { formatSummary, summarize, type Outcome, type Result } from "./score.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const RECALL_TOP = 3;

// ゲートのコマンドは、編集を当てる前のリポジトリが決める（ゲート自体を消す編集で、基準が緩まないように）
function gateCommand(): string {
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {};
  return "check" in scripts ? "pnpm check" : "pnpm typecheck && pnpm test";
}

// ボードは git の外の SQLite にある（決定記録 0011）。いまのボードの写しを 1 つ取り、シナリオごとにそれを複製して渡す
function snapshotBoard(): string {
  const file = join(mkdtempSync(join(tmpdir(), "nagaya-eval-board-")), "board.sqlite");
  board().exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  return file;
}

async function judge(scenario: Scenario, template: string, gate: string, boardSnapshot: string): Promise<Result> {
  const dir = cloneTemplate(template);
  // 複製の外に置く（複製の中だと、ゲートが追跡していないファイルとして読む）
  const boardFile = `${dir}.board.sqlite`;
  copyFileSync(boardSnapshot, boardFile);
  const env = { NAGAYA_BOARD: boardFile };
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
      ? await run("node", ["tools/devboard/src/ops-cli.ts", JSON.stringify(scenario.board)], dir, env)
      : scenario.commit
        ? await commit(dir, scenario.commit, env)
        : await run("sh", ["-c", gate], dir, env);
    const stopped = code !== 0;
    const outcome: Outcome = scenario.kind === "bad" ? (stopped ? "caught" : "missed") : stopped ? "false-alarm" : "passed";
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
    const results: unknown = JSON.parse(output).results;
    if (!Array.isArray(results)) return [];
    return results.slice(0, RECALL_TOP).map((r) => String(r?.id ?? ""));
  } catch {
    return [];
  }
}

const lastLines = (text: string) => text.trim().split("\n").slice(-4).join(" | ").slice(0, 400);

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
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
  },
});
if (values.set !== "public" && values.set !== "heldout") throw new Error("--set は public か heldout");

const scenarios = loadScenarios(join(ROOT, "tools/harness/eval", values.set)).filter(
  (s) => !values.family || s.family === values.family,
);
const template = createTemplate(ROOT);
const boardSnapshot = snapshotBoard();
try {
  if (values.validate) {
    process.exitCode = validate(scenarios, template) ? 1 : 0;
  } else {
    const gate = gateCommand();
    const results = await pool(scenarios, Math.max(2, Math.floor(availableParallelism() / 2)), (s) => judge(s, template, gate, boardSnapshot));
    const summary = summarize(results);
    if (values.set === "public") {
      for (const r of results) console.log(`[${r.outcome}] ${r.scenario.id} ${r.scenario.class}: ${r.scenario.title}${r.detail ? `\n    ${r.detail}` : ""}`);
    }
    console.log(`\n${values.set}（ゲート: ${gate}）`);
    console.log(formatSummary(summary));
    if (values.record) {
      const commitHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
      mkdirSync(join(ROOT, "dev/harness"), { recursive: true });
      appendFileSync(
        join(ROOT, "dev/harness/history.jsonl"),
        JSON.stringify({ at: new Date().toISOString(), set: values.set, commit: commitHash, gate, ...summary }) + "\n",
      );
    }
  }
} finally {
  removeDir(template);
  removeDir(resolve(boardSnapshot, ".."));
}
