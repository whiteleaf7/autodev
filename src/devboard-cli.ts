// devboard コマンド（~/github/devboard。決定記録 0044・0047）を呼ぶ。ツール名の一覧と決定記録の形式は、devboard が持つ知識なので、
// ゲートはその写しを持たず、このコマンドに聞く。CI も、check.yml で devboard を取って入れる。

import { spawnSync } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { z } from "zod";
import type { Problem } from "./repo.ts";

const INSTALL_HINT =
  "git clone https://github.com/whiteleaf7/devboard.git ~/github/devboard のあと、そこで pnpm install と pnpm run link-bin を実行し、~/.local/bin を PATH に入れる";

const TaskList = z.object({ tasks: z.array(z.object({ id: z.string() })) });
const ToolNames = z.array(z.string());

export const parseTaskIds = (json: string): string[] => TaskList.parse(JSON.parse(json)).tasks.map((t) => t.id);
export const parseToolNames = (json: string): string[] => ToolNames.parse(JSON.parse(json));

export type DevboardResult = { ok: true; stdout: string } | { ok: false; message: string };

export function runDevboard(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): DevboardResult {
  const result = spawnSync("devboard", args, { cwd, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error)
    return { ok: false, message: `devboard コマンドを実行できない（${result.error.message}）。${INSTALL_HINT}` };
  if (result.status !== 0)
    return { ok: false, message: `devboard ${args.join(" ")} が失敗した: ${result.stderr.trim()}` };
  return { ok: true, stdout: result.stdout };
}

// 成功したときの出力を返す。失敗は、直し方を添えた例外にする
function devboardOutput(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  const result = runDevboard(args, cwd, env);
  if (!result.ok) throw new Error(result.message);
  return result.stdout;
}

export const readTaskIds = (cwd: string): string[] => parseTaskIds(devboardOutput(["show", "tasks"], cwd));

export const requireToolNames = (cwd: string): string[] => parseToolNames(devboardOutput(["tools"], cwd));

const LintProblems = z.array(z.object({ check: z.string(), file: z.string(), message: z.string() }));
export const parseLintProblems = (json: string): Problem[] => LintProblems.parse(JSON.parse(json));

// devboard lint-decisions に決定記録を渡して、形式の問題を得る。問題があると終了コード 1 で、問題は標準出力に出る
export function lintDecisionFiles(files: { file: string; text: string }[], cwd: string): Problem[] {
  if (!files.length) return [];
  const result = spawnSync("devboard", ["lint-decisions"], {
    cwd,
    input: JSON.stringify(files),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new Error(`devboard コマンドを実行できない（${result.error.message}）。${INSTALL_HINT}`);
  if (result.status === 0 || result.status === 1) return parseLintProblems(result.stdout);
  throw new Error(`devboard lint-decisions が失敗した: ${result.stderr.trim()}`);
}

export function snapshotBoard(file: string, cwd: string): void {
  devboardOutput(["snapshot", file], cwd);
}

// devboard のリポジトリの場所。PATH の devboard（bin/devboard.ts へのリンク）をたどる。DEVBOARD_HOME で指定もできる
export function devboardHome(): string {
  if (process.env.DEVBOARD_HOME) return process.env.DEVBOARD_HOME;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const bin = join(dir, "devboard");
    try {
      accessSync(bin, constants.X_OK);
      return dirname(dirname(realpathSync(bin)));
    } catch {
      // この PATH の項目には無い
    }
  }
  throw new Error(`devboard コマンドが見つからない。${INSTALL_HINT}`);
}
