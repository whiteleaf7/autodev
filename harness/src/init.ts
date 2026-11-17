// 新しいプロジェクトに、autodev を使う設定と文書の雛形（templates/）を書いて、初期化する。
//   autodev init <対象ディレクトリ> [--name <プロジェクト名>] [--title <製品表示名>] [--summary <概要>] [--files-only]
// 実行基盤のコード（ゲート・フック・評価）は、プロジェクトに写さない。autodev を呼ぶ設定と、プロジェクトのデータの置き場所だけを書く

import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { readCommonRules } from "./checks/rules.ts";
import { renderRegion } from "./rules-region.ts";

const USAGE =
  "使い方: autodev init <対象ディレクトリ> [--name <プロジェクト名>] [--title <製品表示名>] [--summary <概要>] [--files-only]";

export const TEMPLATES_DIR = join(import.meta.dirname, "../../templates");
const GITHOOKS_DIR = join(import.meta.dirname, "../../githooks");

export type InitOptions = {
  targetDir: string;
  name: string;
  title: string;
  summary: string;
  filesOnly: boolean;
};

export function toPascalCase(slug: string): string {
  return (
    slug
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join("") || slug
  );
}

export function parseInitArgs(argv: string[]): InitOptions {
  let targetArg: string | undefined;
  let name: string | undefined;
  let title: string | undefined;
  let summary: string | undefined;
  let filesOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${arg} の値が無い\n${USAGE}`);
      return v;
    };
    if (arg === "--name") name = next();
    else if (arg === "--title") title = next();
    else if (arg === "--summary") summary = next();
    else if (arg === "--files-only") filesOnly = true;
    else if (arg.startsWith("-")) throw new Error(`知らない引数: ${arg}\n${USAGE}`);
    else if (!targetArg) targetArg = arg;
    else throw new Error(`対象ディレクトリが複数渡されている: ${arg}\n${USAGE}`);
  }
  if (!targetArg) throw new Error(USAGE);
  const targetDir = resolve(process.env.INIT_CWD ?? process.cwd(), targetArg);
  const resolvedName = (name ?? basename(targetDir)).trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(resolvedName)) {
    throw new Error(`プロジェクト名には英数字・ハイフン・アンダースコアを使う: ${resolvedName}`);
  }
  const resolvedTitle = (title ?? toPascalCase(resolvedName)).trim();
  return {
    targetDir,
    name: resolvedName,
    title: resolvedTitle,
    summary: summary ?? `${resolvedTitle}（${resolvedName}）`,
    filesOnly,
  };
}

// {{name}}・{{title}}・{{summary}}・{{region}} だけを置き換える。GitHub Actions の `${{ ... }}` など、ほかの {{ }} はそのまま
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(name|title|summary|region)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function* files(dir: string, rel = ""): Generator<string> {
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || entry.name === "node_modules") continue;
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* files(dir, path);
    else if (entry.isFile()) yield path;
  }
}

function writeRendered(from: string, to: string, vars: Record<string, string>): void {
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, renderTemplate(readFileSync(from, "utf8"), vars));
  const mode = lstatSync(from).mode;
  if (mode & 0o111) chmodSync(to, mode);
}

export function writeInitFiles(opts: InitOptions): void {
  const { targetDir } = opts;
  if (existsSync(join(targetDir, "package.json"))) {
    throw new Error(`${targetDir} にはすでに package.json がある。空のディレクトリを指定する`);
  }
  const vars = { name: opts.name, title: opts.title, summary: opts.summary, region: renderRegion(readCommonRules()) };
  mkdirSync(targetDir, { recursive: true });
  for (const rel of files(TEMPLATES_DIR)) writeRendered(join(TEMPLATES_DIR, rel), join(targetDir, rel), vars);
  // フックは、autodev hook を呼ぶだけの数行なので、雛形をそのまま写す
  for (const rel of files(GITHOOKS_DIR)) {
    const to = join(targetDir, ".githooks", rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(GITHOOKS_DIR, rel), to);
    chmodSync(to, lstatSync(join(GITHOOKS_DIR, rel)).mode);
  }
}

export function initProject(opts: InitOptions): void {
  writeInitFiles(opts);
  if (opts.filesOnly) return;

  const cwd = realpathSync(opts.targetDir);
  const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

  if (!existsSync(join(cwd, ".git"))) run("git", ["init", "-b", "main"]);
  run("pnpm", ["install"]);

  // devboard コマンドで、ボードの表示名・マイルストーン・最初のタスクを入れる
  const initOps = [
    { op: "set_project", args: { name: opts.title, summary: opts.summary } },
    {
      op: "set_milestone",
      args: {
        id: "M0",
        title: "開発基盤の整備",
        goal: "AI 自律駆動の仕組み（開発ボード・MCP / CLI・ハーネス・画面確認ツール）を整える",
        status: "done",
      },
    },
    {
      op: "create_task",
      args: {
        title: "開発基盤とダッシュボード環境を整備する",
        description: "自律開発基盤（autodev）とダッシュボード（devboard）を使う設定を展開し、新規プロジェクトを進められる準備を行う。",
        priority: "high",
        milestone: "M0",
        paths: ["docs/", ".githooks/", ".github/", ".autodev/"],
      },
    },
    // "$2" は、3 番目の操作（上の create_task）が作ったタスクの ID
    {
      op: "update_task",
      args: { id: "$2", status: "done", note: "動かした: `autodev init` → 設定・文書の展開・pnpm install・初期コミットが完了" },
    },
  ];
  run("devboard", ["apply", JSON.stringify(initOps)]);

  const filesToStage = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  run("git", ["add", "--", ...filesToStage]);
  run("git", ["commit", "-m", "chore: initialize autonomous development environment", "-m", "Task: T-001"]);
}

if (import.meta.main) {
  try {
    const opts = parseInitArgs(process.argv.slice(2));
    initProject(opts);
    console.log(`init: ${opts.title} (${opts.name}) を ${opts.targetDir} に用意した`);
  } catch (e) {
    console.error(`init: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
