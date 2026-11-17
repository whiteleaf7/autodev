// git のフック（.githooks/）から呼ばれる。
//   autodev hook pre-commit              無視されているファイルの混入を確かめ、ステージしたファイルを整形してから、コミットされる中身でゲートを通し、差分に当たった教訓を出す
//   autodev hook commit-msg <ファイル>   コミットメッセージの決まりを確かめる
//   autodev hook pre-push                main への push を止める

import { projectRoot } from "./project-root.ts";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkMessage, filesToFormat, pushesToMain } from "./commit.ts";
import { lessonChecklist, readTaskIds } from "./devboard-cli.ts";

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
  showLessonChecklist();
}

// 過去の教訓のうち、このコミットの差分に引き金が当たったものだけを出す（T-264）。覚えていなくても、同じ所を変えたときに目に入るようにする。
// 止めはしない。ゲートを通ったあとに出すのは、コミットの直前の出力として埋もれないようにするため
function showLessonChecklist(): void {
  const { stdout } = spawnSync("git", ["-c", "core.quotepath=false", "diff", "--cached", "--no-color", "--no-ext-diff"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const checklist = stdout ? lessonChecklist(stdout, ROOT) : "";
  if (checklist) console.error(checklist);
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
