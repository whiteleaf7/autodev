// 検査するプロジェクトの根。autodev は全プロジェクトで共有するコマンドなので、自分の置き場所ではなく、
// コマンドを打った場所（cwd）の git の作業ツリーの根を使う。作業ツリーごとに（linked worktree なら、その worktree が）検査の対象になる。
// AUTODEV_ROOT で別の場所を指せる（テスト用）

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function projectRoot(cwd: string = process.cwd()): string {
  if (process.env.AUTODEV_ROOT) return resolve(process.env.AUTODEV_ROOT);
  const start = resolve(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) throw new Error(`${start} は git のリポジトリの中ではない。プロジェクトのディレクトリで実行する`);
  }
}
