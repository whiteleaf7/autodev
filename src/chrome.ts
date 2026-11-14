// ヘッドレスの Chrome を使い捨てのプロファイルで起動し、DevTools Protocol でページを操作する。
// 画面の撮影（screenshot.ts）と、通知の確認（push.ts）が使う
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseDevToolsActivePort } from "./options.ts";

const chromePath = process.env.NAGAYA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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

export async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
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

export type Page = {
  send: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  // 式の値を返す。Promise なら解決を待つ
  evaluate: (expression: string) => Promise<unknown>;
  // 指定した要素が出るまで待つ
  appears: (selector: string) => Promise<void>;
  // ここまでに出た console.error と例外
  problems: () => string[];
};

export type Browser = {
  // origin に Chrome の権限（例: notifications）を与える
  grant: (origin: string, permissions: string[]) => Promise<void>;
  page: () => Promise<Page>;
};

// Chrome を起動して use に渡し、終わったら Chrome とプロファイルを片付ける
export async function withChrome<T>(timeoutMs: number, use: (browser: Browser) => Promise<T>): Promise<T> {
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
      await waitForFile(join(profile, "DevToolsActivePort"), timeoutMs),
    );
    const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${browserPath}`);
    try {
      return await use({
        grant: async (origin, permissions) => {
          await cdp.send("Browser.grantPermissions", { origin, permissions });
        },
        page: async () => {
          const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
          const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
            targetId,
            flatten: true,
          });
          const send = <R>(method: string, params?: Record<string, unknown>) => cdp.send<R>(method, params, sessionId);
          const evaluate = async (expression: string) =>
            (
              await send<{ result: { value?: unknown } }>("Runtime.evaluate", {
                expression,
                returnByValue: true,
                awaitPromise: true,
              })
            ).result.value;
          await send("Runtime.enable");
          return {
            send,
            evaluate,
            appears: (selector) =>
              waitUntil(
                async () => (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) === true,
                timeoutMs,
                `${selector} が出ない`,
              ),
            problems: () => consoleProblems(cdp.events.filter((event) => event.sessionId === sessionId)),
          };
        },
      });
    } finally {
      cdp.close();
    }
  } finally {
    const exited = once(chrome, "exit");
    chrome.kill();
    await exited;
    // 本体が終わっても、Chrome の補助プロセスが少しの間プロファイルに書き続け、ENOTEMPTY で消せないことがある（T-038）
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
