// devboard コマンド（~/github/devboard。決定記録 0044）を呼ぶ。CI には入っていないので、
// CI でも動かす検査はここに頼らず、ローカルだけで動く処理（コミットメッセージの検査・評価）が使う。

import { spawnSync } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { z } from "zod";

const INSTALL_HINT = "~/github/devboard を clone し、pnpm install と pnpm run link-bin を実行して PATH に入れる";

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

// devboard が無い環境（CI など）では null
export function readToolNames(cwd: string): string[] | null {
  const result = runDevboard(["tools"], cwd);
  return result.ok ? parseToolNames(result.stdout) : null;
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
