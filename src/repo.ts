// 検査が見るリポジトリの姿。いまの作業ツリーと、基点（HEAD）の 2 つを持つ。
// 検査は副作用を持たない関数にして、テストではメモリ上のリポジトリを渡す。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Tree = { files: string[]; read(path: string): string | null };
export type Repo = Tree & { base: Tree | null };

export type Problem = { check: string; file: string; line?: number; message: string };

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
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

export function loadRepo(root: string): Repo {
  const listed = git(root, ["ls-files", "-co", "--exclude-standard", "-z"]);
  if (listed === null) throw new Error(`${root} は git のリポジトリではない`);
  const files = listed.split("\0").filter((f) => f && existsSync(join(root, f)));
  const baseListed = git(root, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]);
  return {
    files,
    read: cached((path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null)),
    base:
      baseListed === null
        ? null
        : {
            files: baseListed.split("\0").filter(Boolean),
            read: cached((path) => git(root, ["show", `HEAD:${path}`])),
          },
  };
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
