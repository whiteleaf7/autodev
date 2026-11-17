// シナリオを当てる先になる、作業ツリーの複製を作る。
// 複製は基点のコミットを持つ git リポジトリなので、ゲートは HEAD との差分を見られる。

import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { devboardHome } from "./devboard-cli.ts";
import type { Edit } from "./scenario.ts";
import { LINKED_MODULES_ENV, linkPackageModules } from "./snapshot.ts";
import { runDir } from "./run-dir.ts";

const SANDBOX_ENV = { ...process.env, ...LINKED_MODULES_ENV };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// 評価のシナリオが見本にしているコード。切り出す前の devboard を、devboard のリポジトリの固定したコミットから取り出して、複製の tools/devboard/ に置く。
// コピーを持たず、コミットは変わらない（devboard の履歴は書き換えない）ので、devboard 本体が変わっても、シナリオが探す文字列は変わらない
export const FIXTURE_COMMIT = "8e7ce0cd8804e90c3bab1f617d6951dcc3dac3e8";
const FIXTURE_DEST = "tools/devboard/";

// home のリポジトリの commit の中身を、dest に展開する
export function extractFixture(home: string, commit: string, dest: string): void {
  let archive: Buffer;
  try {
    archive = execFileSync("git", ["-C", home, "archive", "--format=tar", commit], {
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new Error(
      `評価の見本の devboard のコミット ${commit} を ${home} から取り出せない。浅い clone なら git fetch --unshallow で履歴を取る（${e instanceof Error ? e.message.split("\n")[0] : String(e)}）`,
      { cause: e },
    );
  }
  mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-x", "-C", dest], { input: archive });
}

function overlayFixture(template: string): void {
  const home = realpathSync(devboardHome());
  extractFixture(home, FIXTURE_COMMIT, join(template, FIXTURE_DEST));
  // 見本の依存は、いま入れてある devboard のものを使う（同じ依存で動くコードなので）
  linkPackageModules(home, join(template, FIXTURE_DEST), ["package.json"]);
}

export function createTemplate(repoRoot: string): string {
  const root = realpathSync(repoRoot);
  const template = mkdtempSync(join(runDir(), "template-"));
  const files = git(root, ["ls-files", "-co", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  for (const file of files) {
    const from = join(root, file);
    if (!existsSync(from)) continue; // 追跡中だが、作業ツリーでは消されている
    mkdirSync(dirname(join(template, file)), { recursive: true });
    cpSync(from, join(template, file), { verbatimSymlinks: true });
  }
  linkPackageModules(root, template, files);
  overlayFixture(template);
  git(template, ["init", "-q"]);
  // .gitignore の「node_modules/」は、リンクを含むディレクトリの中身までは隠さない場合に備える
  mkdirSync(join(template, ".git", "info"), { recursive: true });
  writeFileSync(join(template, ".git", "info", "exclude"), "node_modules\n");
  for (const [key, value] of [
    ["user.name", "harness-eval"],
    ["user.email", "harness-eval@localhost"],
    ["commit.gpgsign", "false"],
  ] as const) {
    git(template, ["config", key, value]);
  }
  git(template, ["add", "-A"]);
  git(template, ["commit", "-q", "--no-verify", "-m", "chore: base"]);
  return template;
}

export function cloneTemplate(template: string): string {
  const dir = mkdtempSync(join(runDir(), "scenario-"));
  cpSync(template, dir, { recursive: true, verbatimSymlinks: true });
  return dir;
}

// 途中にリンクがあるパスへは書かない（リンクの先は本物の node_modules）
function crossesSymlink(dir: string, file: string): boolean {
  let current = dir;
  for (const part of file.slice(dir.length + 1).split(sep)) {
    current = join(current, part);
    if (!existsSync(current)) return false;
    if (lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

// 当てられなかったときは、その理由を返す
export function applyEdits(dir: string, edits: Edit[]): string | null {
  for (const edit of edits) {
    const file = resolve(dir, edit.file);
    if (!file.startsWith(dir + sep)) return `${edit.file}: リポジトリの外を指している`;
    if (crossesSymlink(dir, file)) return `${edit.file}: リンクの先には書けない`;
    if ("delete" in edit) {
      if (!existsSync(file)) return `${edit.file}: 消す対象が無い`;
      rmSync(file);
    } else if ("write" in edit) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, edit.write);
    } else {
      if (!existsSync(file)) return `${edit.file}: 置き換える対象が無い`;
      const text = readFileSync(file, "utf8");
      const count = text.split(edit.find).length - 1;
      if (count !== 1) return `${edit.file}: find が ${count} 回現れる（1 回のはず）`;
      writeFileSync(
        file,
        text.replace(edit.find, () => edit.replace),
      );
    }
  }
  return null;
}

export type RunResult = { code: number; output: string };

// 時間切れで止めたときの終了コード（timeout(1) に合わせる）
export const TIMED_OUT = 124;

export function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
  timeoutMs = 180_000,
): Promise<RunResult> {
  return new Promise((done) => {
    // detached にして、時間切れのときにプロセスのグループごと止められるようにする
    const child = spawn(command, args, {
      cwd,
      env: { ...SANDBOX_ENV, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(result);
    };
    const timer = setTimeout(() => {
      // 固まったテストの孫プロセスがパイプを握ったままだと close が来ないので、グループを止めて、待たずに返す
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // すでに終わっている
        }
      }
      finish({ code: TIMED_OUT, output });
    }, timeoutMs);
    child.on("error", (e) => finish({ code: 127, output: e.message }));
    child.on("close", (code) => finish({ code: code ?? TIMED_OUT, output }));
  });
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
