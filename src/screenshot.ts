// Web の画面をヘッドレスの Chrome で撮る。OS の画面収録の許可が要らないので、AI が自分で UI を確かめられる。
// 撮るまでに出たコンソールのエラーと例外も返す。
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Page, waitUntil, withChrome } from "./chrome.ts";
import { parseScreenshotArgs, type ScreenshotOptions } from "./options.ts";

export async function capture(page: Page, out: string): Promise<string> {
  // 描画が落ち着くのを待つ
  await sleep(200);
  const { data } = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
  const file = resolve(out);
  await writeFile(file, Buffer.from(data, "base64"));
  return file;
}

type Viewport = Pick<ScreenshotOptions, "width" | "height" | "mobile">;

// mobile でないと、狭い幅でもパソコンのスクロールバーが幅を取り、hover や pointer の media query もパソコンのままになる
export async function setViewport(page: Page, { width, height, mobile }: Viewport): Promise<void> {
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
}

// navigator.languages は Accept-Language から、Intl の既定は locale の上書きから決まるので、両方を変える
async function setLanguage(page: Page, lang: string): Promise<void> {
  const { userAgent } = await page.send<{ userAgent: string }>("Browser.getVersion");
  await page.send("Emulation.setUserAgentOverride", { userAgent, acceptLanguage: lang });
  await page.send("Emulation.setLocaleOverride", { locale: lang });
}

// 2 枚目は、出力先の名前に -later を足した場所に置く
export const laterPath = (out: string): string => out.replace(/\.png$/, "-later.png");

export async function screenshot(
  options: ScreenshotOptions,
): Promise<{ out: string; later?: string; problems: string[] }> {
  return withChrome(options.timeoutMs, async (browser) => {
    const page = await browser.page();
    await setViewport(page, options);
    await page.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: options.dark ? "dark" : "light" },
        { name: "prefers-reduced-motion", value: options.reducedMotion ? "reduce" : "no-preference" },
      ],
    });
    if (options.lang) await setLanguage(page, options.lang);
    await page.send("Page.navigate", { url: options.url });
    await waitUntil(
      async () => (await page.evaluate("document.readyState")) === "complete",
      options.timeoutMs,
      "読み込みが終わらない",
    );
    if (options.waitFor) await page.appears(options.waitFor);
    for (const step of options.steps) {
      const element = `document.querySelector(${JSON.stringify(step.selector)})`;
      await page.appears(step.selector);
      await page.evaluate(
        step.action === "click"
          ? `${element}.click()`
          : // Preact などは input のイベントで値を読むので、値を入れてからイベントを送る
            `{ const el = ${element}; el.value = ${JSON.stringify(step.value)}; el.dispatchEvent(new Event("input", { bubbles: true })); }`,
      );
      await sleep(200);
    }
    if (options.waitAfter) await page.appears(options.waitAfter);
    const out = await capture(page, options.out);
    if (options.laterMs === undefined) return { out, problems: page.problems() };
    await sleep(options.laterMs);
    const later = await capture(page, laterPath(options.out));
    return { out, later, problems: page.problems() };
  });
}

if (import.meta.main) {
  try {
    const result = await screenshot(parseScreenshotArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
