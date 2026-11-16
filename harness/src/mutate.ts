// 変異テスト。ソースに小さなバグを 1 つずつ入れて、そのパッケージの型チェックとテストが止めるかを見る。
// 止められなかった変異（生き残り）は、テストが確かめていない振る舞いを指している。
//   node src/mutate.ts [対象のファイル...]      既定は tools/ の src と public

import { projectRoot } from "./project-root.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { testsReaching } from "./related-tests.ts";
import { loadRepo, packageDirs } from "./repo.ts";
import { cloneTemplate, createTemplate, removeDir, run, TIMED_OUT } from "./sandbox.ts";
import { lineOf, scan } from "./source.ts";

const ROOT = projectRoot();

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
  {
    label: "条件つきの return / throw を消す",
    pattern: /^[ \t]*if \([^\n]*\) (?:return|throw)\b[^\n]*;[ \t]*$/gm,
    replace: blank,
  },
  { label: "throw を消す", pattern: /^[ \t]*throw new Error\([^\n]*\);[ \t]*$/gm, replace: blank },
];

type Mutant = { file: string; line: number; label: string; before: string; mutated: string };

function mutantsOf(file: string, text: string): Mutant[] {
  const { code } = scan(text);
  return OPERATORS.flatMap(({ label, pattern, replace }) =>
    [...code.matchAll(pattern)].map((m) => {
      const mutated =
        text.slice(0, m.index) +
        replace(text.slice(m.index, m.index + m[0].length)) +
        text.slice(m.index + m[0].length);
      const line = lineOf(text, m.index + m[0].search(/\S/));
      return { file, line, label, before: text.split("\n")[line - 1]!.trim(), mutated };
    }),
  );
}

// 並列の負荷で、パッケージのテストを全部回すと 1 分を超えることがある
const TIMEOUT_MS = 180_000;

const repo = loadRepo(ROOT);
const requested = process.argv.slice(2);
const targets = requested.length
  ? requested
  : repo.files.filter((f) => /^tools\/[^/]+\/(src\/.+\.ts|public\/.+\.js)$/.test(f));
const packages = packageDirs(repo).filter(Boolean);
const packageOf = (file: string) =>
  packages.filter((dir) => file.startsWith(`${dir}/`)).sort((a, b) => b.length - a.length)[0];

// 届くテストで先に止め、通ったときだけ全部を回す。生き残りの判定は、いつも全部のテストで行う
const commandOf = (file: string) => {
  const related = testsReaching(repo, packageOf(file) ?? ".", file);
  const steps = ["pnpm --silent typecheck", "pnpm --silent test"];
  if (related.length) steps.splice(1, 0, `node --test ${related.join(" ")}`);
  return steps.join(" && ");
};
const commands = new Map(targets.map((file) => [file, commandOf(file)]));

const mutants = targets.flatMap((file) => mutantsOf(file, repo.read(file) ?? ""));
const template = createTemplate(ROOT);
const dirs = [template];
// 途中で止めたときも、一時ディレクトリを残さない
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.on(signal, () => {
    dirs.forEach(removeDir);
    process.exit(code);
  });
}
const survivors: Mutant[] = [];
// 時間切れは止めたものとして数えるが、負荷で遅れただけのこともあるので、分けて見せる
const timedOut: Mutant[] = [];
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)} 秒`;
let next = 0;
let finished = 0;
try {
  await Promise.all(
    Array.from({ length: Math.max(2, Math.floor(availableParallelism() / 2)) }, async () => {
      const dir = cloneTemplate(template);
      dirs.push(dir);
      try {
        while (next < mutants.length) {
          const mutant = mutants[next++]!;
          const path = join(dir, mutant.file);
          const original = readFileSync(path, "utf8");
          writeFileSync(path, mutant.mutated);
          const { code } = await run(
            "sh",
            ["-c", commands.get(mutant.file)!],
            join(dir, packageOf(mutant.file) ?? "."),
            {},
            TIMEOUT_MS,
          );
          writeFileSync(path, original);
          if (code === 0) survivors.push(mutant);
          if (code === TIMED_OUT) timedOut.push(mutant);
          // 全対象では長くかかるので、進み具合を標準エラーに出す
          process.stderr.write(`\r${++finished}/${mutants.length}（${elapsed()}）`);
        }
      } finally {
        removeDir(dir);
      }
    }),
  );
} finally {
  removeDir(template);
}

const show = (m: Mutant, note = "") => console.log(`  ${m.line}: ${m.label}${note}  |  ${m.before.slice(0, 110)}`);
const inFile = (list: Mutant[], file: string) => list.filter((m) => m.file === file).sort((a, b) => a.line - b.line);
for (const file of targets) {
  const total = mutants.filter((m) => m.file === file).length;
  const alive = inFile(survivors, file);
  const slow = inFile(timedOut, file);
  console.log(
    `\n${file}: ${total - alive.length}/${total} を止めた${slow.length ? `（うち時間切れ ${slow.length}）` : ""}`,
  );
  alive.forEach((m) => show(m));
  slow.forEach((m) => show(m, "（時間切れ）"));
}
console.log(
  `\n合計: ${mutants.length - survivors.length}/${mutants.length} を止めた（生き残り ${survivors.length}、時間切れ ${timedOut.length}、${elapsed()}）`,
);
