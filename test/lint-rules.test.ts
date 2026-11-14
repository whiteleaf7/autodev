// 自前の検査から oxlint に寄せた規則（決定記録 0013）が、リポジトリの設定で効いていることを確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const RULE = /\[\w+\/([\w-]+)\(([\w-]+)\)\]$/;

// リポジトリの設定の写しで、一時ディレクトリのファイルを lint する。
// - macOS の一時ディレクトリはシンボリックリンクの下にあり、リンクを通したパスだと oxlint が import の循環を見落とすので、実体のパスを渡す
// - tsconfig の無い場所で typeAware のまま動かすと、1 回に 20 秒ほどかかる。ここで確かめるルールは型の情報を使わないので外す
function lint(files: Record<string, string>): Record<string, string[]> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nagaya-lint-")));
  const config = JSON.parse(readFileSync(join(ROOT, ".oxlintrc.json"), "utf8"));
  writeFileSync(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({ ...config, $schema: undefined, options: { typeAware: false } }),
  );
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const { stdout, stderr } = spawnSync(
    join(ROOT, "node_modules/.bin/oxlint"),
    ["-c", join(dir, ".oxlintrc.json"), "-f", "unix", dir],
    { encoding: "utf8" },
  );
  rmSync(dir, { recursive: true, force: true });
  assert.ok(stdout !== null, `oxlint を起動できない: ${stderr}`);
  const found: Record<string, string[]> = Object.fromEntries(Object.keys(files).map((name) => [name, []]));
  for (const line of stdout.split("\n")) {
    const name = Object.keys(files).find((n) => line.startsWith(`${join(dir, n)}:`));
    const rule = RULE.exec(line);
    if (name && rule) found[name]!.push(`${rule[1]}/${rule[2]}`);
  }
  return found;
}

test("型としての any を止め、同じ綴りの別のものは通す", () => {
  const bad = [
    "export let a: any = 1;",
    "declare const b: unknown;\nexport const a = b as any;",
    "export const a: any[] = [];",
    "export type A = Record<string, any>;",
    "export function f(a: any): void {\n  void a;\n}",
  ];
  const good = [
    "// any は使わない\nexport const a = 1;",
    'export const a = "any";',
    "export const a = { any: 1 };",
    "declare const z: { any(): number };\nexport const a = z.any();",
    "export const anyOf = 1;",
    "export const a = /any/;",
  ];
  const files = Object.fromEntries([...bad, ...good].map((code, i) => [`f${i}.ts`, `${code}\n`]));
  const found = lint(files);
  bad.forEach((code, i) => assert.ok(found[`f${i}.ts`]?.includes("typescript/no-explicit-any"), code));
  good.forEach((code, i) => assert.deepEqual(found[`f${bad.length + i}.ts`], [], code));
});

test("理由の無い空の catch を止め、理由をコメントに書いたものは通す", () => {
  const head = "declare function run(): Promise<void>;\n";
  const found = lint({
    "empty.ts": `${head}export async function f() {\n  try {\n    await run();\n  } catch {}\n}\n`,
    "promise.ts": `${head}export async function f() {\n  await run().catch(() => {});\n}\n`,
    "reason.ts": `${head}export async function f() {\n  try {\n    await run();\n  } catch {\n    // まだ無い場合は監視しない\n  }\n}\n`,
    "handled.ts": `${head}export async function f() {\n  return await run().catch(() => null);\n}\n`,
  });
  assert.deepEqual(found["empty.ts"], ["eslint/no-empty"]);
  assert.deepEqual(found["promise.ts"], ["eslint/no-empty-function"]);
  assert.deepEqual(found["reason.ts"], []);
  assert.deepEqual(found["handled.ts"], []);
});

test("型だけの import を含む循環を止め、動的な import は数えない", () => {
  const cyclic = lint({
    "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
    "b.ts": 'import type { C } from "./c.ts";\nexport const b: C = 1;\n',
    "c.ts": 'export { a } from "./a.ts";\nexport type C = number;\n',
  });
  for (const name of ["a.ts", "b.ts", "c.ts"]) assert.deepEqual(cyclic[name], ["import/no-cycle"], name);
  const lazy = lint({
    "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\nexport const c = await import("./c.ts");\n',
    "b.ts": "export const b = 1;\n",
    "c.ts": 'import { a } from "./a.ts";\nexport const c = a;\n',
  });
  assert.deepEqual(Object.values(lazy).flat(), []);
});
