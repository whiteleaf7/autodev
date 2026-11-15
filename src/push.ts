// pnpm --filter @repo/verify push: 承認待ちの Web Push（決定記録 0026）を、本物の push サービスまで通して確かめる。
// 使い捨ての NAGAYA_HOME でデーモンを起動し、ヘッドレスの Chrome で端末を登録して「受け取る」を押し、
// 本物の claude のセッションに承認の要るツールを使わせて、Chrome の Service Worker が出した通知を読む。
// Chrome の購読は Google の push サービス（FCM）を通るので、ネットワークが要る。結果は .dev/verify/push-<日時>/

import { type ExecFileOptions, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { waitUntil, withChrome } from "./chrome.ts";
import { capture, setViewport } from "./screenshot.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");
const TIMEOUT_MS = 30_000;
// claude が起動してツールを使うまで。軽いモデルでも 1 分ほどかかることがある
const PUSH_TIMEOUT_MS = 120_000;
const run = promisify(execFile);

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  if (address === null || typeof address === "string") throw new Error("空いたポートを得られない");
  return address.port;
}

const Shown = z.array(z.object({ title: z.string(), body: z.string(), tag: z.string() }));
const Stored = z.object({ devices: z.array(z.object({ push: z.object({ endpoint: z.string() }).nullable() })) });

type Check = { name: string; ok: boolean; detail: string };

async function main(): Promise<boolean> {
  const out = join(repoRoot, ".dev/verify", `push-${stamp()}`);
  await mkdir(out, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "nagaya-push-"));
  const home = join(dir, "home");
  const work = join(dir, "work");
  await mkdir(work);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const options: ExecFileOptions = {
    cwd: repoRoot,
    env: { ...process.env, NAGAYA_HOME: home, NAGAYA_PORT: String(port), ANTHROPIC_MODEL: "haiku" },
    timeout: TIMEOUT_MS,
  };
  const nagaya = async (...args: string[]) =>
    String((await run("pnpm", ["--silent", "--filter", "@nagaya/daemon", "nagaya", ...args], options)).stdout);
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    console.error(`${ok ? "OK" : "NG"} ${name}: ${detail}`);
  };

  await run("pnpm", ["--filter", "@nagaya/web", "build"], options);
  console.error(await nagaya("daemon", "start"));
  try {
    const code = /\?code=([A-Z0-9-]+)/.exec(await nagaya("pair"))?.[1];
    if (!code) throw new Error("nagaya pair がコードを出さない");

    await withChrome(TIMEOUT_MS, async (browser) => {
      // ヘッドレスでは許可を聞く画面が出ないので、先に与えておく
      await browser.grant(origin, ["notifications"]);
      const page = await browser.page();
      await setViewport(page, { width: 390, height: 844, mobile: false });
      await page.send("Page.navigate", { url: `${origin}/?code=${code}#/settings` });
      await page.appears('.app[data-connection="connected"]');
      await page.appears('.push[data-push="false"]');
      await page.evaluate(`document.querySelector(".push-toggle").click()`);
      await page.appears('.push[data-push="true"]');
      const subscribed = Stored.parse(JSON.parse(await readFile(join(home, "devices.json"), "utf8")));
      const endpoint = subscribed.devices[0]?.push?.endpoint ?? "";
      check(
        "「受け取る」で購読し、デーモンが端末の記録に持つ",
        endpoint.startsWith("https://"),
        new URL(endpoint || "about:blank").host,
      );
      check("通知の欄を撮った", true, await capture(page, join(out, "devices.png")));

      const created = await nagaya(
        "create",
        "--cwd",
        work,
        "Use the Write tool to create hello.txt containing hi. Do nothing else.",
      );
      console.error(created);
      const readShown = async () =>
        Shown.parse(
          await page.evaluate(
            "navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((list) => list.map((n) => ({ title: n.title, body: n.body, tag: n.tag })))",
          ),
        );
      await waitUntil(async () => (await readShown()).length > 0, PUSH_TIMEOUT_MS, "通知が届かない");
      const shown = await readShown();
      const sessionId = /[0-9a-f]{8}-[0-9a-f-]{27}/.exec(await nagaya("list"))?.[0] ?? "";
      check(
        "承認の要求で、Service Worker が「セッションの名前・Needs approval」の通知を出す",
        shown.length === 1 &&
          shown[0]?.body === "Needs approval" &&
          shown[0].title === "work" &&
          shown[0].tag === sessionId,
        JSON.stringify(shown),
      );

      await page.evaluate(`document.querySelector(".push-toggle").click()`);
      await page.appears('.push[data-push="false"]');
      const stopped = Stored.parse(JSON.parse(await readFile(join(home, "devices.json"), "utf8")));
      const browserSubscription = await page.evaluate(
        "navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => s !== null)",
      );
      check(
        "「止める」で、ブラウザの購読とデーモンの記録の両方を消す",
        stopped.devices[0]?.push === null && browserSubscription === false,
        JSON.stringify({ daemon: stopped.devices[0]?.push ?? null, browser: browserSubscription }),
      );
      check("画面に問題が出ていない", page.problems().length === 0, JSON.stringify(page.problems()));
    });
  } catch (error) {
    check("最後まで通る", false, error instanceof Error ? error.message : String(error));
  } finally {
    await nagaya("daemon", "stop").catch(() => undefined);
    await writeFile(join(out, "result.json"), `${JSON.stringify(checks, null, 2)}\n`);
    await rm(dir, { recursive: true, force: true });
  }
  console.error(`結果: ${join(out, "result.json")}`);
  return checks.every((c) => c.ok);
}

if (!(await main())) process.exit(1);
