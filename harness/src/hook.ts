// git のフック（.githooks/）から呼ばれる。
//   node tools/harness/src/hook.ts pre-commit              無視されているファイルの混入を確かめ、ステージしたファイルを整形してから、コミットされる中身でゲートを通す
//   node tools/harness/src/hook.ts commit-msg <ファイル>   コミットメッセージの決まりを確かめる
//   node tools/harness/src/hook.ts pre-push                main への push を止める

import { projectRoot } from "./project-root.ts";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkMessage, filesToFormat, pushesToMain } from "./commit.ts";
import { readTaskIds } from "./devboard-cli.ts";

const ROOT = projectRoot();

function git(args: string[], input?: string): string {
  const { stdout } = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", input });
  return stdout ?? "";
}

const stagedPaths = (filter: string) =>
  git(["diff", "--cached", "--name-only", `--diff-filter=${filter}`, "-z"])
    .split("\0")
    .filter(Boolean);

function fail(problems: string[]): never {
  for (const problem of problems) console.error(`commit: ${problem}`);
  process.exit(1);
}

// 書式はゲートで止めず、コミットの前に直す（決定記録 0013）。対象の絞り込みは biome.json の files.includes に任せる
function formatStaged(staged: string[]): void {
  const unstaged = git(["diff", "--name-only", "-z"]).split("\0").filter(Boolean);
  const { format, skipped } = filesToFormat(staged, unstaged);
  for (const path of skipped)
    console.error(`commit: ${path} は一部だけステージされているので整形しない（あとで pnpm format を実行する）`);
  if (!format.length) return;
  const { status } = spawnSync("pnpm", ["exec", "biome", "format", "--write", "--no-errors-on-unmatched", ...format], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (status !== 0) fail(["整形（biome format）に失敗した。表示された構文の誤りを直す"]);
  git(["add", "--", ...format]);
}

function preCommit(): void {
  const staged = stagedPaths("ACMR");
  // --no-index を付けると、すでに追加されたファイルも .gitignore に照らして判定する
  const ignored = staged.length
    ? git(["check-ignore", "--no-index", "--stdin", "-z"], staged.join("\0")).split("\0").filter(Boolean)
    : [];
  if (ignored.length) {
    fail(
      ignored.map(
        (path) => `${path} は .gitignore で無視されているファイル。コミットに入れない（git restore --staged ${path}）`,
      ),
    );
  }
  formatStaged(staged);
  // 作業ツリーではなく、コミットされる中身でゲートを通す。index の場所（GIT_INDEX_FILE）を引き継ぐため、環境変数はそのまま渡す
  const { status } = spawnSync(process.execPath, [join(import.meta.dirname, "check.ts"), "--staged"], { cwd: ROOT, stdio: "inherit" });
  if (status !== 0) process.exit(status ?? 1);
}

function commitMsg(file: string | undefined): void {
  if (!file || !existsSync(file)) fail(["コミットメッセージのファイルが渡されていない"]);
  const message = readFileSync(file, "utf8");
  // ボードを読むのは、Task: の行があるときだけ（devboard の呼び出しは重い）
  const existingTasks = new Set(/^Task:/m.test(message) ? readTaskIds(ROOT) : []);
  const problems = checkMessage(message, { existingTasks });
  if (problems.length) fail(problems);
}

function prePush(): void {
  if (pushesToMain(readFileSync(0, "utf8")))
    fail(["main には直接 push しない。ブランチの上で pnpm land を実行し、PR から取り込む（決定記録 0015）"]);
}

const [hook, arg] = process.argv.slice(2);
if (hook === "pre-commit") preCommit();
else if (hook === "commit-msg") commitMsg(arg);
else if (hook === "pre-push") prePush();
else fail([`知らないフック: ${hook ?? "（指定なし）"}`]);
