// 変異テスト。ソースに小さなバグを 1 つずつ入れて、そのパッケージの型チェックとテストが止めるかを見る。
// 止められなかった変異（生き残り）は、テストが確かめていない振る舞いを指している。
//   node src/mutate.ts [対象のファイル...]      既定は tools/ の src と public

import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { loadRepo, packageDirs } from "./repo.ts";
import { cloneTemplate, createTemplate, removeDir, run } from "./sandbox.ts";
import { lineOf, scan } from "./source.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

type Operator = { label: string; pattern: RegExp; replace: (match: string) => string };

const blank = (match: string) => match.replace(/\S/g, " ");
const to = (replacement: string) => () => replacement;

const OPERATORS: Operator[] = [
  { label: "=== を !== に", pattern: /===/g, replace: to("!==") },
  { label: "!== を === に", pattern: /!==/g, replace: to("===") },
  { label: "&& を || に", pattern: /&&/g, replace: to("||") },
  { label: "|| を && に", pattern: /\|\|/g, replace: to("&&") },
  { label: "< を <= に", pattern: / < /g, replace: to(" <= ") },
  { label: "<= を < に", pattern: / <= /g, replace: to(" < ") },
  { label: "> を >= に", pattern: / > /g, replace: to(" >= ") },
  { label: ">= を > に", pattern: / >= /g, replace: to(" > ") },
  { label: "true を false に", pattern: /\btrue\b/g, replace: to("false") },
  { label: "false を true に", pattern: /\bfalse\b/g, replace: to("true") },
  { label: "+ 1 を - 1 に", pattern: /\+ 1\b/g, replace: to("- 1") },
  { label: "- 1 を + 1 に", pattern: /- 1\b/g, replace: to("+ 1") },
  { label: "every を some に", pattern: /\.every\(/g, replace: to(".some(") },
  { label: "some を every に", pattern: /\.some\(/g, replace: to(".every(") },
  { label: "否定を外す", pattern: /!(?=[A-Za-z_$(])/g, replace: to("") },
  { label: "条件つきの return / throw を消す", pattern: /^[ \t]*if \([^\n]*\) (?:return|throw)\b[^\n]*;[ \t]*$/gm, replace: blank },
  { label: "throw を消す", pattern: /^[ \t]*throw new Error\([^\n]*\);[ \t]*$/gm, replace: blank },
];

type Mutant = { file: string; line: number; label: string; before: string; mutated: string };

function mutantsOf(file: string, text: string): Mutant[] {
  const { code } = scan(text);
  return OPERATORS.flatMap(({ label, pattern, replace }) =>
    [...code.matchAll(pattern)].map((m) => {
      const mutated = text.slice(0, m.index) + replace(text.slice(m.index, m.index + m[0].length)) + text.slice(m.index + m[0].length);
      const line = lineOf(text, m.index + m[0].search(/\S/));
      return { file, line, label, before: text.split("\n")[line - 1]!.trim(), mutated };
    }),
  );
}

const repo = loadRepo(ROOT);
const requested = process.argv.slice(2);
const targets = requested.length
  ? requested
  : repo.files.filter((f) => /^tools\/[^/]+\/(src\/.+\.ts|public\/.+\.js)$/.test(f) && !f.startsWith("tools/harness/"));
const packages = packageDirs(repo).filter(Boolean);
const packageOf = (file: string) => packages.filter((dir) => file.startsWith(`${dir}/`)).sort((a, b) => b.length - a.length)[0];

const mutants = targets.flatMap((file) => mutantsOf(file, repo.read(file) ?? ""));
const template = createTemplate(ROOT);
const survivors: Mutant[] = [];
let next = 0;
try {
  await Promise.all(
    Array.from({ length: Math.max(2, Math.floor(availableParallelism() / 2)) }, async () => {
      const dir = cloneTemplate(template);
      try {
        while (next < mutants.length) {
          const mutant = mutants[next++]!;
          const path = join(dir, mutant.file);
          const original = readFileSync(path, "utf8");
          writeFileSync(path, mutant.mutated);
          const { code } = await run("sh", ["-c", "pnpm --silent typecheck && pnpm --silent test"], join(dir, packageOf(mutant.file) ?? "."), {}, 90_000);
          writeFileSync(path, original);
          if (code === 0) survivors.push(mutant);
        }
      } finally {
        removeDir(dir);
      }
    }),
  );
} finally {
  removeDir(template);
}

for (const file of targets) {
  const total = mutants.filter((m) => m.file === file).length;
  const alive = survivors.filter((m) => m.file === file).sort((a, b) => a.line - b.line);
  console.log(`\n${file}: ${total - alive.length}/${total} を止めた`);
  for (const m of alive) console.log(`  ${m.line}: ${m.label}  |  ${m.before.slice(0, 110)}`);
}
console.log(`\n合計: ${mutants.length - survivors.length}/${mutants.length} を止めた（生き残り ${survivors.length}）`);
