// ヘッドレスの Chrome を使い捨てのプロファイルで起動し、DevTools Protocol でページを操作する。
// 画面の撮影（screenshot.ts）と、通知の確認（push.ts）が使う
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseDevToolsActivePort } from "./options.ts";

const chromePath = process.env.VERIFY_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };

// SIGTERM で終わらない Chrome を待ち続けないための猶予
const KILL_GRACE_MS = 3_000;

class Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly events: CdpEvent[] = [];
  private readonly socket: WebSocket;
  private readonly timeoutMs: number;

  private constructor(socket: WebSocket, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    // 接続が切れたら、返事を待っている要求は二度と答えが来ないので、すべて失敗にする
    const failPending = () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("DevTools の接続が切れた"));
      this.pending.clear();
    };
    socket.addEventListener("close", failPending);
    socket.addEventListener("error", failPending);
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

  static async connect(url: string, timeoutMs: number): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`DevTools への接続が ${timeoutMs}ms で終わらない: ${url}`)),
        timeoutMs,
      );
      socket.addEventListener(
        "open",
        (event) => {
          clearTimeout(timer);
          resolve(event);
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error(`DevTools に接続できない: ${url}`));
        },
        { once: true },
      );
    }).catch((error: unknown) => {
      socket.close();
      throw error;
    });
    return new Cdp(socket, timeoutMs);
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`DevTools の接続が切れていて ${method} を送れない`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools の ${method} に ${this.timeoutMs}ms 経っても返事が来ない`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
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
  throw new Error(`Chrome が起動しない（${chromePath}）。VERIFY_CHROME で場所を指定できる`);
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
  const profile = await mkdtemp(join(tmpdir(), "autodev-chrome-"));
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
    const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${browserPath}`, timeoutMs);
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
    // 途中で落ちた Chrome の exit は、あとから待っても二度と来ない
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const exited = once(chrome, "exit");
      chrome.kill();
      // SIGTERM を無視して居座る Chrome を、いつまでも待たない
      const forceKill = setTimeout(() => {
        chrome.kill("SIGKILL");
      }, KILL_GRACE_MS);
      await exited;
      clearTimeout(forceKill);
    }
    // 本体が終わっても、Chrome の補助プロセスが少しの間プロファイルに書き続け、ENOTEMPTY で消せないことがある（T-038）
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
