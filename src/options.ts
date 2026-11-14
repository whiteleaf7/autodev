import { parseArgs } from "node:util";
import { z } from "zod";

const ScreenshotOptions = z.object({
  url: z.url(),
  out: z.string().endsWith(".png", "出力先は .png にする"),
  waitFor: z.string().min(1).optional(),
  // クリックの前に、入力欄に値を入れる（<CSS セレクタ>=<値>）。登録のコードを打つなど。
  // セレクタには [name=code] のように = が入るので、最後の = で分ける（値に = は使えない）
  fill: z
    .array(
      z
        .string()
        .regex(/^.+=[^=]*$/, "--fill は <CSS セレクタ>=<値> にする")
        .transform((pair) => ({
          selector: pair.slice(0, pair.lastIndexOf("=")),
          value: pair.slice(pair.lastIndexOf("=") + 1),
        })),
    )
    .default([]),
  // 撮る前に、この順にクリックする要素（モーダルを開くなど）
  click: z.array(z.string().min(1)).default([]),
  // クリックの後、撮る前に出るのを待つ要素
  waitAfter: z.string().min(1).optional(),
  width: z.coerce.number().int().positive().default(1280),
  height: z.coerce.number().int().positive().default(800),
  timeoutMs: z.coerce.number().int().positive().default(15_000),
});
export type ScreenshotOptions = z.infer<typeof ScreenshotOptions>;

export const usage =
  "使い方: pnpm --filter @nagaya/verify screenshot <url> <出力先.png> [--wait-for <CSS セレクタ>] [--fill <CSS セレクタ>=<値>]... [--click <CSS セレクタ>]... [--wait-after <CSS セレクタ>] [--width 1280] [--height 800] [--timeout 15000]";

export function parseScreenshotArgs(argv: string[]): ScreenshotOptions {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "wait-for": { type: "string" },
      fill: { type: "string", multiple: true },
      click: { type: "string", multiple: true },
      "wait-after": { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
      timeout: { type: "string" },
    },
  });
  const parsed = ScreenshotOptions.safeParse({
    url: positionals[0],
    out: positionals[1],
    waitFor: values["wait-for"],
    fill: values.fill,
    click: values.click,
    waitAfter: values["wait-after"],
    width: values.width,
    height: values.height,
    timeoutMs: values.timeout,
  });
  if (!parsed.success) {
    throw new Error(`${z.prettifyError(parsed.error)}\n${usage}`);
  }
  return parsed.data;
}

/** Chrome が user-data-dir に書く DevToolsActivePort（1 行目がポート、2 行目がブラウザの WebSocket のパス） */
export function parseDevToolsActivePort(text: string): { port: number; browserPath: string } {
  const [portLine, pathLine] = text.trim().split("\n");
  const port = Number(portLine);
  if (!Number.isInteger(port) || port <= 0 || !pathLine?.startsWith("/devtools/browser/")) {
    throw new Error(`DevToolsActivePort の形が想定と違う: ${JSON.stringify(text)}`);
  }
  return { port, browserPath: pathLine };
}
