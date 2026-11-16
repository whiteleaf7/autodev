// pnpm verify:app: 本物の殻（apps/desktop）を、使い捨ての NAGAYA_HOME で起動し、UI から本物の claude のセッションを
// 作って承認し、ターンの終わりまでを通す。殻の画面（WKWebView の PNG）・画面の会話・ログを .dev/verify/ に残す。
// 筋書きと合否は app-scenario.ts。アプリを変えたタスクを done にするときの「動かした証拠」に使う（docs/verification.md）

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { parseAppArgs } from "./app-options.ts";
import { judge, OBSERVE, Observed, PROOF_FILE, PROOF_MD_FILE, scenario, type Step } from "./app-scenario.ts";
import { LinkReceiver, STILL_OPEN_AFTER_MS } from "./link-receiver.ts";
import { waitFor } from "./wait.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");
const launcher = join(repoRoot, "apps/desktop/build/dev-macos-arm64/nagaya-dev.app/Contents/MacOS/launcher");

const PluginManifest = z.object({ id: z.string().min(1) });

// 外のプラグインを使い捨ての NAGAYA_HOME に置き、渡した順に有効にする（決定記録 0034 の置き場所と plugins.json）。ID を返す
async function placePlugins(home: string, dirs: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  await mkdir(join(home, "plugins"), { recursive: true });
  for (const given of dirs) {
    const dir = resolve(repoRoot, given);
    const manifest = join(dir, "nagaya-plugin.json");
    const { id } = PluginManifest.parse(
      JSON.parse(
        await readFile(manifest, "utf8").catch(() => {
          throw new Error(`${manifest} が無い。--plugin にはプラグインのディレクトリを渡す`);
        }),
      ),
    );
    await symlink(dir, join(home, "plugins", id));
    ids.push(id);
  }
  await writeFile(join(home, "plugins.json"), `${JSON.stringify({ enabled: ids })}\n`);
  return ids;
}

const ProcessInfo = z.object({ pid: z.number().int().positive(), port: z.number().int().positive() });

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

async function readInfo(file: string): Promise<z.infer<typeof ProcessInfo> | null> {
  try {
    return ProcessInfo.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

async function run(command: string, args: string[], logFile: string): Promise<void> {
  const log = createWriteStream(logFile);
  const child = spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} が失敗した（${code}）。${logFile} を見る`);
}

// 殻の開発用の口（apps/desktop/src/bun/control.ts）
class Shell {
  private readonly base: string;
  private readonly token: string;

  constructor(port: number, token: string) {
    this.base = `http://127.0.0.1:${port}`;
    this.token = token;
  }

  async evaluate(body: string): Promise<unknown> {
    const response = await fetch(`${this.base}/eval`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}` },
      body,
    });
    if (!response.ok) throw new Error(`画面の中で失敗した: ${await response.text()}`);
    return z.object({ value: z.unknown() }).parse(await response.json()).value;
  }

  async snapshot(file: string): Promise<void> {
    const response = await fetch(`${this.base}/snapshot`, { headers: { authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`殻の画面を撮れない: ${await response.text()}`);
    await writeFile(file, new Uint8Array(await response.arrayBuffer()));
  }
}

type StepResult = { name: string; ok: boolean; ms: number; error?: string; snapshot?: string };

async function runStep(shell: Shell, step: Step, out: string): Promise<StepResult> {
  const started = Date.now();
  if (step.act) await shell.evaluate(step.act);
  const until = step.until;
  if (until)
    await waitFor("画面がこの状態にならない", step.timeoutMs, async () =>
      (await shell.evaluate(until)) === true ? true : null,
    );
  if (step.snapshot) await shell.snapshot(join(out, step.snapshot));
  return { name: step.name, ok: true, ms: Date.now() - started, snapshot: step.snapshot };
}

const ARRIVAL_STEP = "既定のブラウザが開き、受け口に要求が届く";

async function waitForArrival(receiver: LinkReceiver): Promise<StepResult> {
  const started = Date.now();
  await waitFor(
    "受け口に要求が届かない。shell.log の「既定のアプリで開く」を見る",
    15_000,
    async () => receiver.arrival,
  );
  // 開いたページが自分を閉じられたかは、閉じられなかったときに届く要求で分かる
  await sleep(STILL_OPEN_AFTER_MS + 1_500);
  return { name: ARRIVAL_STEP, ok: true, ms: Date.now() - started };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopProcess(pid: number): Promise<void> {
  if (!isAlive(pid)) return;
  process.kill(pid, "SIGTERM");
  await waitFor(`pid ${pid} が止まらない`, 10_000, async () => (isAlive(pid) ? null : true)).catch(() =>
    process.kill(pid, "SIGKILL"),
  );
}

async function main(): Promise<boolean> {
  const options = parseAppArgs(process.argv.slice(2));
  const out = resolve(repoRoot, options.out ?? `.dev/verify/app-${stamp()}`);
  await mkdir(out, { recursive: true });
  const shown = (file: string) => relative(repoRoot, join(out, file));

  if (options.build) {
    console.log("殻をビルドしている（--skip-build で飛ばせる）");
    await run("pnpm", ["--filter", "@nagaya/desktop", "build"], join(out, "build.log"));
  }
  if (!existsSync(launcher)) throw new Error(`殻が無い: ${launcher}。--skip-build を外して動かす`);

  // 本物の ~/.nagaya と、このリポジトリのフックや CLAUDE.md が効かない場所で動かす
  const home = await mkdtemp(join(tmpdir(), "nagaya-verify-home-"));
  const cwd = await mkdtemp(join(tmpdir(), "nagaya-verify-work-"));
  const results: StepResult[] = [];
  let shellProcess: ChildProcess | null = null;
  let observed: Observed | null = null;
  let problems: string[] = [];
  const receiver = options.openLink ? await LinkReceiver.start() : null;
  try {
    const plugins = await placePlugins(home, options.plugins);
    const shellLog = createWriteStream(join(out, "shell.log"));
    const child = spawn(launcher, [], {
      env: { ...process.env, NAGAYA_HOME: home, NAGAYA_PORT: String(await freePort()), ANTHROPIC_MODEL: options.model },
      stdio: ["ignore", "pipe", "pipe"],
    });
    shellProcess = child;
    child.stdout.pipe(shellLog);
    child.stderr.pipe(shellLog);

    // shell.json の pid は、launcher が起こした殻の Bun のもの
    const control = await waitFor("殻が開発用の口を開けない。shell.log を見る", 30_000, async () => {
      const info = await readInfo(join(home, "shell.json"));
      return info && isAlive(info.pid) ? info : null;
    });
    const shell = new Shell(control.port, (await readFile(join(home, "token"), "utf8")).trim());

    const runners = scenario(cwd, receiver?.url ?? null, plugins, options.openViewer).map((step) => ({
      name: step.name,
      run: async () => {
        const result = await runStep(shell, step, out);
        if (step.observe) observed = Observed.parse(await shell.evaluate(OBSERVE));
        return result;
      },
    }));
    if (receiver) runners.push({ name: ARRIVAL_STEP, run: () => waitForArrival(receiver) });
    for (const runner of runners) {
      const started = Date.now();
      try {
        results.push(await runner.run());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const snapshotFailure = await shell.snapshot(join(out, "failure.png")).then(
          () => null,
          (snapshotError: unknown) => `。画面も撮れなかった: ${String(snapshotError)}`,
        );
        results.push({
          name: runner.name,
          ok: false,
          ms: Date.now() - started,
          error: `${message}${snapshotFailure ?? ""}`,
          snapshot: snapshotFailure ? undefined : "failure.png",
        });
        break;
      }
    }
    observed ??= Observed.parse(await shell.evaluate(OBSERVE));
    await writeFile(join(out, "transcript.txt"), observed.transcript);
    if (results.every((result) => result.ok)) {
      const proofFile = options.openViewer ? PROOF_MD_FILE : PROOF_FILE;
      const proof = await readFile(join(cwd, proofFile), "utf8").catch(() => null);
      problems = judge(observed, proof, options.openViewer);
    }
  } finally {
    await receiver?.close();
    if (shellProcess?.pid) await stopProcess(shellProcess.pid);
    const shellBun = await readInfo(join(home, "shell.json"));
    if (shellBun) await stopProcess(shellBun.pid);
    const daemon = await readInfo(join(home, "daemon.pid"));
    if (daemon) await stopProcess(daemon.pid);
    if (existsSync(join(home, "daemon.log"))) await copyFile(join(home, "daemon.log"), join(out, "daemon.log"));
    const sessions = await readdir(join(home, "sessions")).catch(() => []);
    for (const name of sessions) await copyFile(join(home, "sessions", name), join(out, `session-${name}`));
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }

  const failed = results.find((result) => !result.ok);
  const ok = failed === undefined && problems.length === 0;
  const link = receiver && { url: receiver.url, arrival: receiver.arrival, tabStayedOpen: receiver.tabStayedOpen };
  await writeFile(
    join(out, "result.json"),
    `${JSON.stringify({ ok, model: options.model, plugins: options.plugins, steps: results, problems, link, observed }, null, 2)}\n`,
  );

  for (const result of results) {
    const seconds = (result.ms / 1000).toFixed(1);
    console.log(
      `${result.ok ? "ok  " : "失敗"} ${result.name}（${seconds} 秒）${result.snapshot ? ` → ${shown(result.snapshot)}` : ""}`,
    );
    if (result.error) console.log(`     ${result.error}`);
  }
  for (const problem of problems) console.log(`失敗 ${problem}`);
  if (link?.arrival) {
    const tab = link.tabStayedOpen ? "タブは自分を閉じられず残った" : "タブが残った知らせは来なかった（閉じたと見る）";
    console.log(`     受け口に届いた: ${link.arrival.at}、User-Agent: ${link.arrival.userAgent ?? "無し"}。${tab}`);
  }
  console.log(
    `${ok ? "通った" : "通らなかった"}: 画面・会話・ログは ${relative(repoRoot, out)}/（result.json に要点）`,
  );
  return ok;
}

try {
  process.exitCode = (await main()) ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
