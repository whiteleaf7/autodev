import { parseArgs } from "node:util";
import { z } from "zod";

// --mobile で幅と高さを省いたときは、よくあるスマホの大きさ（iPhone の 390×844）で撮る
const viewportDefaults = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };

const Step = z.discriminatedUnion("action", [
  // 入力欄に値を入れる（<CSS セレクタ>=<値>）。セレクタには [name=code] のように = が入るので、
  // 最後の = で分ける（値に = は使えない）
  z
    .object({ action: z.literal("fill"), arg: z.string().regex(/^.+=[^=]*$/, "--fill は <CSS セレクタ>=<値> にする") })
    .transform(({ arg }) => ({
      action: "fill" as const,
      selector: arg.slice(0, arg.lastIndexOf("=")),
      value: arg.slice(arg.lastIndexOf("=") + 1),
    })),
  z
    .object({ action: z.literal("click"), arg: z.string().min(1) })
    .transform(({ arg }) => ({ action: "click" as const, selector: arg })),
]);

const ScreenshotOptions = z
  .object({
    url: z.url(),
    out: z.string().endsWith(".png", "出力先は .png にする"),
    waitFor: z.string().min(1).optional(),
    // 撮る前に、コマンドラインに並んだ順に行う入力とクリック。クリックの後に出る入力欄も埋められる
    steps: z.array(Step).default([]),
    // 操作の後、撮る前に出るのを待つ要素
    waitAfter: z.string().min(1).optional(),
    width: z.coerce.number().int().positive().optional(),
    height: z.coerce.number().int().positive().optional(),
    mobile: z.boolean().default(false),
    // prefers-color-scheme を dark にして撮る（省くと light）
    dark: z.boolean().default(false),
    // prefers-reduced-motion を reduce にして撮る（動きを止める設定の画面）
    reducedMotion: z.boolean().default(false),
    // 撮ったあと、このミリ秒だけ待って同じ画面をもう 1 枚撮る（<出力先>-later.png）。動いているかを 2 枚の違いで確かめる
    laterMs: z.coerce.number().int().positive().optional(),
    // ブラウザの言語（navigator.languages と Intl）を、この言語タグにして撮る（省くと Chrome のまま）
    lang: z
      .string()
      .refine((tag) => {
        try {
          return Intl.getCanonicalLocales(tag).length === 1;
        } catch {
          return false;
        }
      }, "--lang は ja や en-US のような言語タグにする")
      .optional(),
    timeoutMs: z.coerce.number().int().positive().default(15_000),
  })
  .transform((options) => {
    const defaults = viewportDefaults[options.mobile ? "mobile" : "desktop"];
    return { ...options, width: options.width ?? defaults.width, height: options.height ?? defaults.height };
  });
export type ScreenshotOptions = z.infer<typeof ScreenshotOptions>;

export const usage =
  "使い方: pnpm --filter @nagaya/verify screenshot <url> <出力先.png> [--wait-for <CSS セレクタ>] [--fill <CSS セレクタ>=<値> | --click <CSS セレクタ>]... [--wait-after <CSS セレクタ>] [--width 1280] [--height 800] [--mobile] [--dark] [--reduced-motion] [--later <ミリ秒>] [--lang ja] [--timeout 15000]";

export function parseScreenshotArgs(argv: string[]): ScreenshotOptions {
  const { positionals, values, tokens } = parseArgs({
    args: argv,
    allowPositionals: true,
    // values は名前ごとにまとめるので、--fill と --click の前後は tokens から読む
    tokens: true,
    options: {
      "wait-for": { type: "string" },
      fill: { type: "string", multiple: true },
      click: { type: "string", multiple: true },
      "wait-after": { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
      mobile: { type: "boolean" },
      dark: { type: "boolean" },
      "reduced-motion": { type: "boolean" },
      later: { type: "string" },
      lang: { type: "string" },
      timeout: { type: "string" },
    },
  });
  const parsed = ScreenshotOptions.safeParse({
    url: positionals[0],
    out: positionals[1],
    waitFor: values["wait-for"],
    steps: tokens.flatMap((token) =>
      token.kind === "option" && (token.name === "fill" || token.name === "click")
        ? [{ action: token.name, arg: token.value }]
        : [],
    ),
    waitAfter: values["wait-after"],
    width: values.width,
    height: values.height,
    mobile: values.mobile,
    dark: values.dark,
    reducedMotion: values["reduced-motion"],
    laterMs: values.later,
    lang: values.lang,
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
