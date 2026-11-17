// リポジトリの中身を一時ディレクトリに写し、元の node_modules をリンクして、そこでゲートを回せるようにする。
// pre-commit は index（コミットされる中身）を写す。ハーネスの評価（sandbox.ts）は作業ツリーを写す。

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { childTimeoutMs, throwIfTimeout } from "./child-limit.ts";

// pnpm 11 は、写しの中で依存のずれを見つけると pnpm install を始め、リンク先の node_modules を消そうとする
export const LINKED_MODULES_ENV = { pnpm_config_verify_deps_before_run: "false" };

// node_modules は丸ごとリンクせず、中身を 1 つずつリンクする。
// 丸ごとリンクすると、写しの node_modules 直下への書き込みが本物に届き、workspace のパッケージも本物の側を指してしまう。
// workspace のパッケージへのリンクは、写しの中の同じパッケージに向け直す（相対リンクなので、写しをさらに写しても保たれる）
function linkModules(from: string, to: string, root: string, copy: string): void {
  mkdirSync(to);
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    if (!existsSync(source)) continue; // 切れたリンク
    if (name.startsWith("@") && !lstatSync(source).isSymbolicLink()) {
      linkModules(source, join(to, name), root, copy);
      continue;
    }
    const real = realpathSync(source);
    const isWorkspacePackage = real.startsWith(root + sep) && !real.includes(`${sep}node_modules${sep}`);
    symlinkSync(isWorkspacePackage ? relative(to, join(copy, relative(root, real))) : source, join(to, name));
  }
}

// root は realpath を取ったもの。files は写したファイル（package.json の場所から、パッケージを見つける）
export function linkPackageModules(root: string, copy: string, files: string[]): void {
  const packageDirs = files.filter((f) => f === "package.json" || f.endsWith("/package.json")).map((f) => dirname(f));
  for (const dir of packageDirs) {
    const modules = join(root, dir, "node_modules");
    if (existsSync(modules)) linkModules(modules, join(copy, dir, "node_modules"), root, copy);
  }
}

// git が渡す GIT_INDEX_FILE を引き継いで読むので、git commit <パス> や -a の一時的な index も、そのまま写せる
export function snapshotIndex(repoRoot: string): { dir: string; files: string[] } {
  const root = realpathSync(repoRoot);
  const dir = mkdtempSync(join(tmpdir(), "autodev-staged-"));
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: childTimeoutMs(),
      });
    } catch (e) {
      throwIfTimeout(e, "git", args);
      throw e;
    }
  };
  git(["checkout-index", "--all", `--prefix=${dir}/`]);
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  linkPackageModules(root, dir, files);
  return { dir, files };
}
