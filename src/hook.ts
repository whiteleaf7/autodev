// git のフック（.githooks/）から呼ばれる。
//   node tools/harness/src/hook.ts pre-commit              ゲートと、無視されているファイルの混入を確かめる
//   node tools/harness/src/hook.ts commit-msg <ファイル>   コミットメッセージの決まりを確かめる

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readTasks } from "@nagaya/devboard/src/store.ts";
import { decisionFilesOutsideMain, checkMessage } from "./commit.ts";
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
  const decisionFiles = decisionFilesOutsideMain(stagedPaths("ACMRD"), gitDir !== commonDir);
  if (decisionFiles.length) fail(decisionFiles);
  const { status } = spawnSync("pnpm", ["check"], { cwd: ROOT, stdio: "inherit", env: withoutGitEnv(process.env) });
  if (status !== 0) process.exit(status ?? 1);
}

function commitMsg(file: string | undefined): void {
  if (!file || !existsSync(file)) fail(["コミットメッセージのファイルが渡されていない"]);
  const problems = checkMessage(readFileSync(file, "utf8"), { existingTasks: new Set(readTasks().tasks.map((t) => t.id)) });
  if (problems.length) fail(problems);
}

const [hook, arg] = process.argv.slice(2);
if (hook === "pre-commit") preCommit();
else if (hook === "commit-msg") commitMsg(arg);
else fail([`知らないフック: ${hook ?? "（指定なし）"}`]);
