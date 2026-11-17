// 検査が見るリポジトリの姿。いまの姿（作業ツリーか、pre-commit では index を写したもの）と、基点（HEAD）の 2 つを持つ。
// 検査は副作用を持たない関数にして、テストではメモリ上のリポジトリを渡す。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { childTimeoutMs, throwIfTimeout } from "./child-limit.ts";
import { scan } from "./source.ts";

export type Tree = { files: string[]; read(path: string): string | null };
export type Repo = Tree & { base: Tree | null };

export type Problem = { check: string; file: string; line?: number; message: string };

export function formatProblem({ check, file, line, message }: Problem): string {
  return `${file}${line ? `:${line}` : ""}: [${check}] ${message}`;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
      timeout: childTimeoutMs(),
    });
  } catch (e) {
    throwIfTimeout(e, "git", args); // 終わらない git を、「無い」と取り違えない
    return null; // git の管理下でない、または HEAD がまだ無い
  }
}

function cached(read: (path: string) => string | null): (path: string) => string | null {
  const cache = new Map<string, string | null>();
  return (path) => {
    if (!cache.has(path)) cache.set(path, read(path));
    return cache.get(path) ?? null;
  };
}

const baseFiles = (listed: string): string[] => listed.split("\0").filter(Boolean);

// ゲートが基点と比べるのは、テスト・package.json・tsconfig・lint と整形の設定。1 つずつ git show すると、1000 件近くで 10 秒近くかかるので、
// 最初の 1 回で、まとめて git cat-file --batch で読む。それ以外は、必要になったとき 1 つずつ読む
const PREFETCHED_FROM_BASE =
  /(^|\/)(package\.json|tsconfig[^/]*\.json|\.oxlintrc\.json|biome\.json)$|\.test\.(ts|tsx|mts|js|mjs)$/;

// git cat-file --batch の出力（<ID> blob <バイト数>\n<中身>\n、または <指定> missing\n）を、指定の順に読む
export function parseCatFileBatch(output: Buffer, specs: string[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  let pos = 0;
  for (const spec of specs) {
    const end = output.indexOf(0x0a, pos);
    if (end < 0) break;
    const header = output.subarray(pos, end).toString("utf8");
    pos = end + 1;
    const size = /^[0-9a-f]+ blob (\d+)$/.exec(header)?.[1];
    if (size === undefined) {
      result.set(spec, null);
      continue;
    }
    result.set(spec, output.subarray(pos, pos + Number(size)).toString("utf8"));
    pos += Number(size) + 1;
  }
  return result;
}

// rev は "HEAD"（基点）か ""（index。`:<パス>` で読む）
function gitTreeReader(root: string, files: string[], rev: "HEAD" | ""): (path: string) => string | null {
  let prefetched: Map<string, string | null> | null = null;
  const prefetch = (): Map<string, string | null> => {
    const wanted = files.filter((f) => PREFETCHED_FROM_BASE.test(f));
    const specs = wanted.map((f) => `${rev}:${f}`);
    try {
      const output = execFileSync("git", ["cat-file", "--batch"], {
        cwd: root,
        input: specs.map((spec) => `${spec}\n`).join(""),
        maxBuffer: 512 * 1024 * 1024,
        stdio: ["pipe", "pipe", "ignore"],
        timeout: childTimeoutMs(),
      });
      const read = parseCatFileBatch(output, specs);
      return new Map(wanted.map((f) => [f, read.get(`${rev}:${f}`) ?? null]));
    } catch (e) {
      throwIfTimeout(e, "git", ["cat-file", "--batch"]);
      return new Map();
    }
  };
  return cached((path) => {
    prefetched ??= prefetch();
    return prefetched.has(path) ? (prefetched.get(path) ?? null) : git(root, ["show", `${rev}:${path}`]);
  });
}

function headTree(root: string): Tree | null {
  const listed = git(root, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]);
  if (listed === null) return null;
  const files = baseFiles(listed);
  return { files, read: gitTreeReader(root, files, "HEAD") };
}

// staged を渡すと、作業ツリーの代わりに、index を写したもの（snapshot.ts の snapshotIndex）をいまの姿として読む
export function loadRepo(root: string, staged?: { dir: string; files: string[] }): Repo {
  const listed = staged?.files ?? git(root, ["ls-files", "-co", "--exclude-standard", "-z"])?.split("\0");
  if (!listed) throw new Error(`${root} は git のリポジトリではない`);
  const dir = staged?.dir ?? root;
  const files = listed.filter((f) => f && existsSync(join(dir, f)));
  return {
    files,
    read: cached((path) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), "utf8") : null)),
    base: headTree(root),
  };
}

// index（コミットされる中身）を、写さずに git から読む。commit-msg のように、中身の一部だけを基点と比べるときに使う。
// git が渡す GIT_INDEX_FILE を引き継ぐので、git commit -a やパスを指定したコミットの一時的な index も読める
export function loadIndexRepo(root: string): Repo {
  const listed = git(root, ["ls-files", "-z"]);
  if (listed === null) throw new Error(`${root} は git のリポジトリではない`);
  const files = baseFiles(listed);
  return { files, read: gitTreeReader(root, files, ""), base: headTree(root) };
}

export function memoryRepo(now: Record<string, string>, base?: Record<string, string>): Repo {
  const tree = (files: Record<string, string>): Tree => ({
    files: Object.keys(files),
    read: (path) => files[path] ?? null,
  });
  return { ...tree(now), base: base ? tree(base) : null };
}

// 検査の対象にするコード（プロダクトと開発ツール）。spikes は捨てる前提の実験なので含めない
export const isProductCode = (path: string) =>
  /^(tools|apps|packages)\/.+\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path);
export const isTestFile = (path: string) => /\.test\.(ts|tsx|mts|js|mjs)$/.test(path);

// パッケージのルート（package.json のあるディレクトリ）。ルート自身は ""
export function packageDirs(tree: Tree): string[] {
  return tree.files
    .filter((f) => f === "package.json" || f.endsWith("/package.json"))
    .map((f) => f.slice(0, -"package.json".length).replace(/\/$/, ""));
}

export function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// JSONC（コメントと末尾のカンマを許す JSON）。tsconfig と .oxlintrc.json がこの形
export const parseJsonc = (text: string | null): unknown =>
  text === null ? null : parseJson(scan(text).withStrings.replace(/,(\s*[}\]])/g, "$1"));
