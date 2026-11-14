import { parseArgs } from "node:util";
import { z } from "zod";

const AppOptions = z.object({
  // 省略すると、殻をビルドし直してから動かす（古い .app で確かめてしまわないため）
  build: z.boolean(),
  // 本物の claude の利用枠を抑えるため、既定は軽いモデル（ANTHROPIC_MODEL で claude に渡す）
  model: z.string().min(1).default("haiku"),
  out: z.string().min(1).optional(),
  // 既定のブラウザのタブを 1 つ開くので、リンクの扱いを変えたときだけ付ける
  openLink: z.boolean(),
  // 外のプラグインのディレクトリ（リポジトリの根からの相対か絶対）。使い捨ての NAGAYA_HOME に置いて有効にしてから起動する
  plugins: z.array(z.string().min(1)),
});
export type AppOptions = z.infer<typeof AppOptions>;

export const appUsage =
  "使い方: pnpm verify:app [--skip-build] [--model haiku] [--open-link] [--plugin <プラグインのディレクトリ>]... [--out <結果を置くディレクトリ>]";

export function parseAppArgs(argv: string[]): AppOptions {
  let values: { "skip-build"?: boolean; model?: string; out?: string; "open-link"?: boolean; plugin?: string[] };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "skip-build": { type: "boolean", default: false },
        model: { type: "string" },
        out: { type: "string" },
        "open-link": { type: "boolean", default: false },
        plugin: { type: "string", multiple: true, default: [] },
      },
    }));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${appUsage}`);
  }
  const parsed = AppOptions.safeParse({
    build: !values["skip-build"],
    model: values.model,
    out: values.out,
    openLink: values["open-link"],
    plugins: values.plugin,
  });
  if (!parsed.success) throw new Error(`${z.prettifyError(parsed.error)}\n${appUsage}`);
  return parsed.data;
}
