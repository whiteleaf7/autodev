// 評価と変異テストが作る一時物（テンプレート・複製・ボードの写し）を、1 回の実行ごとに 1 つの親ディレクトリにまとめる。
// 終わったとき、止められたとき（SIGINT・SIGTERM）に、親ごと 1 度で消す。強制終了（SIGKILL）や電源断では消せないので、
// 次の実行の始めに、持ち主のプロセスがいない古い親ディレクトリを掃除する（バラバラに作っていた頃は、止められた評価の残りが /var/folders に溜まった）

import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREFIX = "autodev-run-";
// 評価も変異テストも、数十分で終わる。持ち主がいなくても、これより新しいものは触らない
export const STALE_MS = 6 * 60 * 60 * 1000;

type Entry = { name: string; mtimeMs: number };

// 持ち主のプロセスがいない、古い親ディレクトリの名前（autodev-run-<プロセス番号>-<乱数>）
export function staleRunDirs(entries: Entry[], now: number, ownerAlive: (pid: number) => boolean): string[] {
  return entries
    .filter((entry) => {
      const owner = /^autodev-run-(\d+)-/.exec(entry.name);
      return owner !== null && now - entry.mtimeMs > STALE_MS && !ownerAlive(Number(owner[1]));
    })
    .map((entry) => entry.name);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // 権限が無いだけで、プロセスは居る
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// 掃除した数
export function sweepStaleRunDirs(base: string = tmpdir(), now: number = Date.now()): number {
  const entries = readdirSync(base)
    .filter((name) => name.startsWith(PREFIX))
    .flatMap((name) => {
      try {
        return [{ name, mtimeMs: statSync(join(base, name)).mtimeMs }];
      } catch {
        return [];
      }
    });
  const stale = staleRunDirs(entries, now, isAlive);
  for (const name of stale) rmSync(join(base, name), { recursive: true, force: true });
  return stale.length;
}

let current: string | undefined;

// この実行の親ディレクトリ。最初に呼ばれたときに作り、終了時とシグナルで消す
export function runDir(): string {
  if (current) return current;
  const dir = mkdtempSync(join(tmpdir(), `${PREFIX}${process.pid}-`));
  current = dir;
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.on(signal, () => process.exit(code));
  }
  return dir;
}
