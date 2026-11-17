// 速い検査が見つけた問題の記録。observe の検査が「止めていたはずのもの」と、enforce の検査が止めたものを、1 行 1 件で残す。
// 誤検出を見てから検査を enforce にするため、と、どの検査がどれだけ止めているかを数えるため。
// worktree の間で共有するため、git の共通の .git ディレクトリに置く（リポジトリの中身には入れない）

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { gitCommonDir } from "./gate-cache.ts";
import type { Problem } from "./repo.ts";

const GateLogEntry = z.object({
  at: z.number(),
  mode: z.enum(["observe", "enforce"]),
  check: z.string(),
  file: z.string(),
  line: z.number().optional(),
  message: z.string(),
});
export type GateLogEntry = z.infer<typeof GateLogEntry>;

export function gateLogFile(root: string): string | null {
  const common = gitCommonDir(root);
  return common ? join(common, "autodev-gate-log.jsonl") : null;
}

export function appendGateLog(file: string, entries: GateLogEntry[]): void {
  if (!entries.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
}

// 読めない行（書きかけ、古い形）は飛ばす
export function parseGateLog(text: string): GateLogEntry[] {
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const parsed = GateLogEntry.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

export const readGateLog = (file: string): GateLogEntry[] =>
  existsSync(file) ? parseGateLog(readFileSync(file, "utf8")) : [];

const where = ({ file, line }: Pick<Problem, "file" | "line">) => `${file}${line ? `:${line}` : ""}`;

type Group = { mode: GateLogEntry["mode"]; check: string; times: number; last: number; distinct: Map<string, number> };

// mode と検査ごとに、記録した回数・違う指摘の数・最後に記録した日時と、回数の多い順の例を出す。
// 同じ中身を、手での check・pre-commit・land が続けて検査するので、同じ指摘は 1 つにまとめて数える
export function summarizeGateLog(entries: GateLogEntry[], examples: number): string {
  if (!entries.length) return "記録は無い";
  const groups = new Map<string, Group>();
  for (const entry of entries) {
    const id = `${entry.mode}\0${entry.check}`;
    const group = groups.get(id) ?? { mode: entry.mode, check: entry.check, times: 0, last: 0, distinct: new Map() };
    group.times += 1;
    group.last = Math.max(group.last, entry.at);
    const problem = `${where(entry)}: ${entry.message}`;
    group.distinct.set(problem, (group.distinct.get(problem) ?? 0) + 1);
    groups.set(id, group);
  }
  const heading = { observe: "止めずに記録した（observe）", enforce: "止めた（enforce）" } as const;
  const lines: string[] = [];
  for (const mode of ["observe", "enforce"] as const) {
    const ofMode = [...groups.values()].filter((group) => group.mode === mode).toSorted((a, b) => b.times - a.times);
    if (!ofMode.length) continue;
    lines.push(heading[mode]);
    for (const group of ofMode) {
      const last = new Date(group.last).toLocaleString("ja-JP");
      lines.push(`  ${group.check}: ${group.distinct.size} 件の指摘を ${group.times} 回（最後は ${last}）`);
      const sorted = [...group.distinct].toSorted((a, b) => b[1] - a[1]);
      for (const [problem, times] of sorted.slice(0, examples)) lines.push(`    ${problem}（${times} 回）`);
      if (sorted.length > examples) lines.push(`    ほか ${sorted.length - examples} 件`);
    }
  }
  return lines.join("\n");
}
