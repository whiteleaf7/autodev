// ゲートの lint・型チェック・テストの結果を、同じ中身なら使い回す。
// 1 回の取り込みで、同じ中身が、手での check・コミットの pre-commit・land で、何度も検査される。鍵は、リポジトリの全ファイルの中身と、
// 結果を左右する環境のハッシュ。1 バイトでも変われば、必ず回し直す。CI は使わない（CI は、いつも全部を回す、最後の砦）。
// 速い検査（評価の緩め・規約・記録・ドキュメント）は、いつも回す

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FileHash = { path: string; hash: string };
export type Entry = { key: string; at: number };

export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 50;

export function gateKey(files: FileHash[], environment: string[]): string {
  const hash = createHash("sha256");
  for (const item of environment) hash.update(`env:${item}\0`);
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(`${file.path}\0${file.hash}\0`);
  }
  return hash.digest("hex");
}

export function hashFiles(dir: string, paths: string[]): FileHash[] {
  return paths.map((path) => {
    try {
      return { path, hash: createHash("sha256").update(readFileSync(join(dir, path))).digest("hex") };
    } catch {
      return { path, hash: "unreadable" };
    }
  });
}

// テストの結果を左右する環境。Chrome の有無で、Chrome を使うテストは、動く・飛ぶが変わる
export function environmentOf(): string[] {
  return [
    process.version,
    process.platform,
    process.arch,
    `VERIFY_CHROME=${process.env.VERIFY_CHROME ?? ""}`,
    `chrome-app=${existsSync("/Applications/Google Chrome.app")}`,
  ];
}

export function parseEntries(text: string | null, now: number): Entry[] {
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Entry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Entry).key === "string" &&
        typeof (entry as Entry).at === "number" &&
        now - (entry as Entry).at < TTL_MS,
    );
  } catch {
    return [];
  }
}

export const lookup = (entries: Entry[], key: string): Entry | undefined => entries.find((entry) => entry.key === key);

// worktree の間で共有するため、git の共通の .git ディレクトリに置く
export function cacheFile(root: string): string | null {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return join(common, "autodev-gate-cache.json");
  } catch {
    return null;
  }
}

export function readEntries(file: string, now: number): Entry[] {
  return parseEntries(existsSync(file) ? readFileSync(file, "utf8") : null, now);
}

export function recordPass(file: string, key: string, now: number): void {
  const entries = [...readEntries(file, now).filter((entry) => entry.key !== key), { key, at: now }].slice(-MAX_ENTRIES);
  mkdirSync(join(file, ".."), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(entries));
  renameSync(temp, file);
}
