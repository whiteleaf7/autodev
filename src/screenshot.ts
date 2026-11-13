// Web の画面をヘッドレスの Chrome で撮る。OS の画面収録の許可が要らないので、AI が自分で UI を確かめられる。
// 撮るまでに出たコンソールのエラーと例外も返す。
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseDevToolsActivePort, parseScreenshotArgs, type ScreenshotOptions } from "./options.ts";

const chromePath =
  process.env.NAGAYA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };

class Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly events: CdpEvent[] = [];
  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      } & Partial<CdpEvent>;
      if (message.id === undefined) {
        if (message.method) this.events.push(message as CdpEvent);
        return;
      }
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message));
      else waiter?.resolve(message.result);
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error(`DevTools に接続できない: ${url}`)), { once: true });
    });
    return new Cdp(socket);
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function waitForFile(path: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readFile(path, "utf8").catch(() => "");
    if (text.includes("\n")) return text;
    await sleep(50);
  }
  throw new Error(`Chrome が起動しない（${chromePath}）。NAGAYA_CHROME で場所を指定できる`);
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`${timeoutMs}ms 待っても ${what}`);
}

function consoleProblems(events: CdpEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.method === "Runtime.exceptionThrown") {
      const details = event.params.exceptionDetails as { text: string; exception?: { description?: string } };
      return [`exception: ${details.exception?.description ?? details.text}`];
    }
    if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") {
      const args = event.params.args as { value?: unknown; description?: string }[];
      return [`console.error: ${args.map((a) => a.description ?? String(a.value)).join(" ")}`];
    }
    return [];
  });
}

export async function screenshot(options: ScreenshotOptions): Promise<{ out: string; problems: string[] }> {
  const profile = await mkdtemp(join(tmpdir(), "nagaya-chrome-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    const { port, browserPath } = parseDevToolsActivePort(
      await waitForFile(join(profile, "DevToolsActivePort"), options.timeoutMs),
    );
    const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${browserPath}`);
    try {
      const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      const page = <T>(method: string, params?: Record<string, unknown>) => cdp.send<T>(method, params, sessionId);
      const evaluate = async (expression: string) =>
        (await page<{ result: { value?: unknown } }>("Runtime.evaluate", { expression, returnByValue: true })).result.value;

      await page("Runtime.enable");
      await page("Emulation.setDeviceMetricsOverride", {
        width: options.width,
        height: options.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page("Page.navigate", { url: options.url });
      await waitUntil(async () => (await evaluate("document.readyState")) === "complete", options.timeoutMs, "読み込みが終わらない");
      const appears = (selector: string) =>
        waitUntil(async () => (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) === true, options.timeoutMs, `${selector} が出ない`);
      if (options.waitFor) await appears(options.waitFor);
      for (const selector of options.click) {
        await appears(selector);
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
        await sleep(200);
      }
      // 描画が落ち着くのを待つ
      await sleep(200);
      const { data } = await page<{ data: string }>("Page.captureScreenshot", { format: "png" });
      const out = resolve(options.out);
      await writeFile(out, Buffer.from(data, "base64"));
      return { out, problems: consoleProblems(cdp.events) };
    } finally {
      cdp.close();
    }
  } finally {
    const exited = once(chrome, "exit");
    chrome.kill();
    await exited;
    await rm(profile, { recursive: true, force: true });
  }
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
