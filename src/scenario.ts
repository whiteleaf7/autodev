// ハーネス評価のシナリオ。形式と意味は eval/SPEC.md に書いてある。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const FAMILIES = ["defects", "conventions", "eval-weakening", "records", "docs", "commits", "recall"] as const;
export type Family = (typeof FAMILIES)[number];

const Edit = z.union([
  z.strictObject({ file: z.string().min(1), find: z.string().min(1), replace: z.string() }),
  z.strictObject({ file: z.string().min(1), write: z.string() }),
  z.strictObject({ file: z.string().min(1), delete: z.literal(true) }),
]);
export type Edit = z.infer<typeof Edit>;

export const Scenario = z
  .object({
    id: z.string().min(1),
    family: z.enum(FAMILIES),
    kind: z.enum(["bad", "good", "query"]),
    class: z.string().min(1),
    title: z.string().min(1),
    rule: z.string().default(""),
    edits: z.array(Edit).default([]),
    // records だけ。ボード（SQLite の写し）に、AI の書き込みとして当てる操作。中身は当てたときにボードが判定する（不正な入力も bad の例になる）
    board: z.array(z.strictObject({ op: z.string().min(1), args: z.record(z.string(), z.unknown()) })).default([]),
    commit: z.object({ message: z.string().min(1), stage: z.array(z.string().min(1)).min(1) }).optional(),
    query: z.string().min(1).optional(),
    expect: z.array(z.string().min(1)).min(1).optional(),
  })
  .superRefine((s, ctx) => {
    const isQuery = s.kind === "query";
    if (isQuery !== (s.family === "recall")) ctx.addIssue({ code: "custom", message: "query は recall だけに使う" });
    if (isQuery && !(s.query && s.expect)) ctx.addIssue({ code: "custom", message: "query には query と expect が要る" });
    if ((s.family === "commits") !== Boolean(s.commit)) ctx.addIssue({ code: "custom", message: "commit は commits だけに書く" });
    if (s.board.length && s.family !== "records") ctx.addIssue({ code: "custom", message: "board は records だけに書く" });
    if (!isQuery && s.edits.length === 0 && s.board.length === 0) ctx.addIssue({ code: "custom", message: "edits も board も空" });
  });
export type Scenario = z.infer<typeof Scenario>;

export function loadScenarios(dir: string): Scenario[] {
  if (!existsSync(dir)) return [];
  const scenarios = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const parsed = z.array(Scenario).safeParse(JSON.parse(readFileSync(join(dir, name), "utf8")));
      if (!parsed.success) throw new Error(`${join(dir, name)}: ${z.prettifyError(parsed.error)}`);
      return parsed.data;
    });
  const seen = new Set<string>();
  for (const { id } of scenarios) {
    if (seen.has(id)) throw new Error(`シナリオの id が重複している: ${id}`);
    seen.add(id);
  }
  return scenarios;
}
