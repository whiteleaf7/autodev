import { parseArgs } from "node:util";
import { z } from "zod";

const AppOptions = z.object({
  // 省略すると、殻をビルドし直してから動かす（古い .app で確かめてしまわないため）
  build: z.boolean(),
  // 本物の claude の利用枠を抑えるため、既定は軽いモデル（ANTHROPIC_MODEL で claude に渡す）
  model: z.string().min(1).default("haiku"),
  out: z.string().min(1).optional(),
});
export type AppOptions = z.infer<typeof AppOptions>;

export const appUsage = "使い方: pnpm verify:app [--skip-build] [--model haiku] [--out <結果を置くディレクトリ>]";

export function parseAppArgs(argv: string[]): AppOptions {
  let values: { "skip-build"?: boolean; model?: string; out?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "skip-build": { type: "boolean", default: false },
        model: { type: "string" },
        out: { type: "string" },
      },
    }));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${appUsage}`);
  }
  const parsed = AppOptions.safeParse({ build: !values["skip-build"], model: values.model, out: values.out });
  if (!parsed.success) throw new Error(`${z.prettifyError(parsed.error)}\n${appUsage}`);
  return parsed.data;
}
