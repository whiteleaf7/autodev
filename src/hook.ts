// git のフック（.githooks/）から呼ばれる。
//   node tools/harness/src/hook.ts pre-commit              ゲートと、無視されているファイルの混入を確かめる
//   node tools/harness/src/hook.ts commit-msg <ファイル>   コミットメッセージの決まりを確かめる

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { boardFilesOutsideMain, checkMessage, taskIdsOf } from "./commit.ts";
import { withoutGitEnv } from "./env.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

function git(args: string[], input?: string): string {
  const { stdout } = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", input });
  return stdout ?? "";
}

const stagedPaths = (filter: string) => git(["diff", "--cached", "--name-only", `--diff-filter=${filter}`, "-z"]).split("\0").filter(Boolean);

function fail(problems: string[]): never {
  for (const problem of problems) console.error(`commit: ${problem}`);
  process.exit(1);
}

function preCommit(): void {
  const staged = stagedPaths("ACMR");
  // --no-index を付けると、すでに追加されたファイルも .gitignore に照らして判定する
  const ignored = staged.length ? git(["check-ignore", "--no-index", "--stdin", "-z"], staged.join("\0")).split("\0").filter(Boolean) : [];
  if (ignored.length) {
    fail(ignored.map((path) => `${path} は .gitignore で無視されているファイル。コミットに入れない（git restore --staged ${path}）`));
  }
  const [gitDir, commonDir] = git(["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]).trim().split("\n");
  const boardFiles = boardFilesOutsideMain(stagedPaths("ACMRD"), gitDir !== commonDir);
  if (boardFiles.length) fail(boardFiles);
  const { status } = spawnSync("pnpm", ["check"], { cwd: ROOT, stdio: "inherit", env: withoutGitEnv(process.env) });
  if (status !== 0) process.exit(status ?? 1);
}

function commitMsg(file: string | undefined): void {
  if (!file || !existsSync(file)) fail(["コミットメッセージのファイルが渡されていない"]);
  const tasksDir = join(ROOT, "dev/tasks");
  const changedTasks = taskIdsOf(stagedPaths("ACMRD"));
  const onBoard = existsSync(tasksDir) ? taskIdsOf(readdirSync(tasksDir).map((name) => `dev/tasks/${name}`)) : [];
  const problems = checkMessage(readFileSync(file, "utf8"), { changedTasks, existingTasks: new Set([...onBoard, ...changedTasks]) });
  if (problems.length) fail(problems);
}

const [hook, arg] = process.argv.slice(2);
if (hook === "pre-commit") preCommit();
else if (hook === "commit-msg") commitMsg(arg);
else fail([`知らないフック: ${hook ?? "（指定なし）"}`]);
