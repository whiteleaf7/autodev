// 評価を緩める変更を見つける。ここが緩むと、ゲートを通ったことの意味がなくなる。
// 基点（HEAD）と比べて、テストや検査が減っていないかも見る。

import { isTestFile, packageDirs, parseJson, type Problem, type Repo, type Tree } from "../repo.ts";
import { lineOf, matchingClose, scan } from "../source.ts";

const SKIP_CALL = /\b(test|it|describe|suite|t|ctx|context)\s*\.\s*(skip|only|todo)\b/g;
// 第 2 引数のオプションで、無条件に飛ばす形（true か理由の文字列）。code では文字列の中身が空白になっている。
// 「Chrome が無ければ飛ばす」のような条件つきの式は、環境の違いを吸収するためのものなので通す
const SKIP_OPTION = /\b(test|it|describe|suite)\s*\(\s*["'`]\s*["'`]\s*,\s*\{[^{}]*\b(skip|only|todo)\s*:\s*(true\b|["'`])/g;
// 「.test(」（正規表現のメソッド）を数えないよう、前に . や識別子が続くものは除く
const TEST_CASE = /(?<![.\w$])(test|it)\s*\(/g;
const ASSERTION = /\bassert\b|\bexpect\s*\(/;
const SUPPRESSION = /@ts-(ignore|expect-error|nocheck)\b/g;
const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const STRICT_FLAGS = [
  "strict", "noImplicitAny", "strictNullChecks", "strictFunctionTypes", "strictBindCallApply", "strictPropertyInitialization",
  "noImplicitThis", "useUnknownInCatchVariables", "alwaysStrict", "noUncheckedIndexedAccess", "noImplicitReturns",
  "noFallthroughCasesInSwitch", "noImplicitOverride", "noPropertyAccessFromIndexSignature", "exactOptionalPropertyTypes",
  "noUnusedLocals", "noUnusedParameters", "erasableSyntaxOnly", "verbatimModuleSyntax", "checkJs", "isolatedModules",
];
const REQUIRED_FLAGS = ["strict", "noUncheckedIndexedAccess", "erasableSyntaxOnly", "verbatimModuleSyntax"];
// true にすると検査が緩むもの
const LOOSENING_FLAGS = ["noCheck", "allowUnreachableCode", "allowUnusedLabels", "noStrictGenericChecks"];

const GATE_SCRIPTS = ["typecheck", "test", "check"];
const NEUTERED = [
  /\|\|/, // 失敗を無視する
  /^\s*(true|:|exit\b.*|echo\b.*)\s*$/, // 何もしない
  /[;&]\s*(true|exit\s+0)\s*$/,
  /--noCheck|--test-only|--test-(skip|name)-pattern/,
];

const isProductPath = (path: string) => /^(tools|apps|packages)\//.test(path);

function testCases(text: string | null): number {
  return text === null ? 0 : (scan(text).code.match(TEST_CASE) ?? []).length;
}

function skippedTests(repo: Repo): Problem[] {
  return repo.files.filter(isTestFile).flatMap((file) => {
    const { code } = scan(repo.read(file) ?? "");
    return [...code.matchAll(SKIP_CALL), ...code.matchAll(SKIP_OPTION)].map((m) => ({
      check: "skipped-test",
      file,
      line: lineOf(code, m.index),
      message: "テストを飛ばしている・絞っている（skip / only / todo）。直してから通す",
    }));
  });
}

function removedTests(repo: Repo, base: Tree): Problem[] {
  const count = (tree: Tree, dir: string) =>
    tree.files.filter((f) => isTestFile(f) && f.startsWith(`${dir}/`)).reduce((n, f) => n + testCases(tree.read(f)), 0);
  return packageDirs(base)
    .filter(Boolean)
    .flatMap((dir) => {
      const before = count(base, dir);
      const after = count(repo, dir);
      if (after >= before) return [];
      return [{ check: "removed-test", file: `${dir}/`, message: `テストが ${before} 件から ${after} 件に減った。対象のコードごと消すとき以外は、テストを消さない` }];
    });
}

function hollowTests(repo: Repo): Problem[] {
  return repo.files.filter(isTestFile).flatMap((file) => {
    const { code } = scan(repo.read(file) ?? "");
    return [...code.matchAll(TEST_CASE)].flatMap((m) => {
      const open = m.index + m[0].length - 1;
      const close = matchingClose(code, open);
      if (close < 0 || ASSERTION.test(code.slice(open, close))) return [];
      return [{ check: "hollow-test", file, line: lineOf(code, m.index), message: "アサーションが無いテスト。何を確かめるのかを assert で書く" }];
    });
  });
}

type TsConfig = { compilerOptions: Record<string, unknown>; include: string[]; exclude: string[] };

// tsconfig はコメントと末尾のカンマを許す
function parseTsConfig(text: string | null): TsConfig | null {
  if (text === null) return null;
  const json = parseJson(scan(text).withStrings.replace(/,(\s*[}\]])/g, "$1"));
  if (typeof json !== "object" || json === null) return null;
  const { compilerOptions, include, exclude } = json as Record<string, unknown>;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  return {
    compilerOptions: typeof compilerOptions === "object" && compilerOptions !== null ? (compilerOptions as Record<string, unknown>) : {},
    include: strings(include),
    exclude: strings(exclude),
  };
}

function tsconfigs(repo: Repo): Problem[] {
  const isTsConfig = (f: string) => /(^|\/)tsconfig[^/]*\.json$/.test(f);
  const problems: Problem[] = [];
  const add = (file: string, message: string) => problems.push({ check: "loosened-tsconfig", file, message });
  for (const file of repo.base?.files.filter(isTsConfig) ?? []) {
    if (!repo.files.includes(file)) add(file, "tsconfig が消えている");
  }
  for (const file of repo.files.filter(isTsConfig)) {
    const now = parseTsConfig(repo.read(file));
    if (!now) {
      add(file, "tsconfig が読めない");
      continue;
    }
    const before = parseTsConfig(repo.base?.read(file) ?? null);
    for (const flag of STRICT_FLAGS) {
      if (now.compilerOptions[flag] === false) add(file, `${flag} を false にしている`);
      else if (before?.compilerOptions[flag] === true && now.compilerOptions[flag] !== true) add(file, `${flag} を外している`);
    }
    for (const flag of LOOSENING_FLAGS) if (now.compilerOptions[flag] === true) add(file, `${flag} で検査を緩めている`);
    if (isProductPath(file)) {
      for (const flag of REQUIRED_FLAGS) if (now.compilerOptions[flag] === undefined) add(file, `${flag} が無い（true にする）`);
    }
    for (const entry of before?.include ?? []) if (!now.include.includes(entry)) add(file, `検査の対象（include）から ${entry} を外している`);
    for (const entry of now.exclude) if (!before?.exclude.includes(entry)) add(file, `${entry} を検査の対象から外している（exclude）`);
  }
  return problems;
}

function scriptsOf(tree: Tree | null, file: string): Record<string, string> {
  const json = parseJson(tree?.read(file) ?? null);
  const scripts = typeof json === "object" && json !== null ? (json as Record<string, unknown>).scripts : null;
  if (typeof scripts !== "object" || scripts === null) return {};
  return Object.fromEntries(Object.entries(scripts).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function scripts(repo: Repo): Problem[] {
  const problems: Problem[] = [];
  for (const dir of packageDirs(repo)) {
    const file = dir ? `${dir}/package.json` : "package.json";
    const now = scriptsOf(repo, file);
    const before = scriptsOf(repo.base, file);
    const add = (message: string) => problems.push({ check: "neutered-script", file, message });
    for (const name of GATE_SCRIPTS) {
      const script = now[name];
      if (script === undefined) {
        if (before[name] !== undefined) add(`スクリプト ${name} が消えている`);
        continue;
      }
      if (NEUTERED.some((pattern) => pattern.test(script))) add(`スクリプト ${name} が、何もしない・失敗を無視する形になっている`);
      if (!dir && /(^|\s)(--filter|-F)(\s|=)/.test(script)) add(`スクリプト ${name} が、一部のパッケージだけに絞っている`);
      const tokens = script.split(/\s+/);
      const dropped = (before[name] ?? "").split(/\s+/).filter((token) => token && !tokens.includes(token));
      if (dropped.length) add(`スクリプト ${name} から ${dropped.join(" ")} が消えている`);
    }
  }
  return problems;
}

function suppressions(repo: Repo): Problem[] {
  return repo.files.filter((f) => CODE_FILE.test(f)).flatMap((file) => {
    const { comments } = scan(repo.read(file) ?? "");
    return [...comments.matchAll(SUPPRESSION)].map((m) => ({
      check: "suppressed-type-error",
      file,
      line: lineOf(comments, m.index),
      message: `型エラーを @ts-${m[1]} で黙らせている。型を直す`,
    }));
  });
}

function workspaceGlobs(text: string | null): string[] {
  const lines = (text ?? "").split("\n");
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start < 0) return [];
  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s*["']?([^"'\s#]+)["']?/.exec(line);
    if (item) globs.push(item[1]!);
    else if (/^\S/.test(line)) break;
  }
  return globs;
}

const inWorkspace = (dir: string, globs: string[]) =>
  globs.some((glob) => glob === dir || (glob.endsWith("/*") && dir.startsWith(glob.slice(0, -1)) && !dir.slice(glob.length - 1).includes("/")));

function workspace(repo: Repo): Problem[] {
  const file = "pnpm-workspace.yaml";
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ check: "unplugged-package", file: path, message });
  const globs = workspaceGlobs(repo.read(file));
  const before = workspaceGlobs(repo.base?.read(file) ?? null);
  for (const glob of before) if (!globs.includes(glob)) add(file, `workspace から ${glob} が外れている（そのパッケージの検査が走らなくなる）`);
  for (const glob of globs) if (glob.startsWith("!") && !before.includes(glob)) add(file, `${glob} でパッケージを workspace から外している`);

  // ソースを持つパッケージは、workspace に入っていて、検査のスクリプトを持つ
  const roots = new Set(repo.files.map((f) => /^((?:tools|apps|packages)\/[^/]+)\/src\/.+\.tsx?$/.exec(f)?.[1]).filter((r): r is string => Boolean(r)));
  for (const root of roots) {
    const manifest = `${root}/package.json`;
    if (!repo.files.includes(manifest)) {
      add(manifest, "ソースがあるのに package.json が無い（検査が走らない）");
      continue;
    }
    if (globs.length && !inWorkspace(root, globs)) add(manifest, "workspace に入っていない（検査が走らない）");
    const own = scriptsOf(repo, manifest);
    if (!own.typecheck) add(manifest, "typecheck スクリプトが無い");
    if (!own.test && repo.files.some((f) => f.startsWith(`${root}/`) && isTestFile(f))) add(manifest, "テストがあるのに test スクリプトが無い");
  }
  return problems;
}

export function checkGate(repo: Repo): Problem[] {
  return [
    ...skippedTests(repo),
    ...(repo.base ? removedTests(repo, repo.base) : []),
    ...hollowTests(repo),
    ...tsconfigs(repo),
    ...scripts(repo),
    ...suppressions(repo),
    ...workspace(repo),
  ];
}
