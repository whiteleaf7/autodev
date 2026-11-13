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
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Edit } from "./scenario.ts";

// pnpm は複製の中で依存のずれを見つけると pnpm install を始め、リンク先の node_modules を消そうとする
const SANDBOX_ENV = { ...process.env, pnpm_config_verify_deps_before_run: "false" };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// node_modules は丸ごとリンクせず、中身を 1 つずつリンクする。
// 丸ごとリンクすると、複製の node_modules 直下への書き込みが本物に届いてしまう。
// workspace のパッケージへのリンクは、複製の中の同じパッケージに向け直す（相対リンクなので、複製をさらに写しても保たれる）
function linkModules(from: string, to: string, root: string, template: string): void {
  mkdirSync(to);
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    if (!existsSync(source)) continue; // 切れたリンク
    if (name.startsWith("@") && !lstatSync(source).isSymbolicLink()) {
      linkModules(source, join(to, name), root, template);
      continue;
    }
    const real = realpathSync(source);
    const isWorkspacePackage = real.startsWith(root + sep) && !real.includes(`${sep}node_modules${sep}`);
    symlinkSync(isWorkspacePackage ? relative(to, join(template, relative(root, real))) : source, join(to, name));
  }
}

export function createTemplate(repoRoot: string): string {
  const root = realpathSync(repoRoot);
  const template = mkdtempSync(join(tmpdir(), "nagaya-harness-"));
  const files = git(root, ["ls-files", "-co", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  for (const file of files) {
    const from = join(root, file);
    if (!existsSync(from)) continue; // 追跡中だが、作業ツリーでは消されている
    mkdirSync(dirname(join(template, file)), { recursive: true });
    cpSync(from, join(template, file));
  }
  const packageDirs = files.filter((f) => f === "package.json" || f.endsWith("/package.json")).map((f) => dirname(f));
  for (const dir of packageDirs) {
    const modules = join(root, dir, "node_modules");
    if (existsSync(modules)) linkModules(modules, join(template, dir, "node_modules"), root, template);
  }
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
  const dir = mkdtempSync(join(tmpdir(), "nagaya-scenario-"));
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
      finish({ code: 124, output });
    }, timeoutMs);
    child.on("error", (e) => finish({ code: 127, output: e.message }));
    child.on("close", (code) => finish({ code: code ?? 124, output }));
  });
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
