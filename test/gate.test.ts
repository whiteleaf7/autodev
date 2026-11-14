import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGate } from "../src/checks/gate.ts";
import { memoryRepo } from "../src/repo.ts";

const checksOf = (now: Record<string, string>, base?: Record<string, string>) =>
  checkGate(memoryRepo(now, base)).map((p) => p.check);

const passing = `import { test } from "node:test";\ntest("a", () => {\n  assert.equal(1, 1);\n});\n`;

test("無条件にテストを飛ばす書き方を見つけ、条件つきの skip は通す", () => {
  const file = "tools/x/test/a.test.ts";
  assert.deepEqual(checksOf({ [file]: passing.replace("test(", "test.skip(") }), ["skipped-test"]);
  assert.deepEqual(checksOf({ [file]: passing.replace("test(", "test.only(") }), ["skipped-test"]);
  assert.deepEqual(checksOf({ [file]: passing.replace('"a", ', '"a", { skip: true }, ') }), ["skipped-test"]);
  assert.deepEqual(checksOf({ [file]: passing.replace('"a", ', '"a", { todo: "あとで" }, ') }), ["skipped-test"]);
  assert.deepEqual(checksOf({ [file]: passing.replace('"a", ', '"a", { skip: !installed && "無い" }, ') }), []);
  assert.deepEqual(checksOf({ [file]: `const text = "test.skip(";\n${passing}` }), [], "文字列の中は見ない");
});

test("テストが基点より減ったら止め、パッケージの中での移動は通す", () => {
  const manifest = { "tools/x/package.json": `{"scripts":{"typecheck":"tsc --noEmit","test":"node --test"}}` };
  const base = { ...manifest, "tools/x/test/a.test.ts": passing, "tools/x/test/b.test.ts": passing };
  assert.deepEqual(checksOf({ ...manifest, "tools/x/test/a.test.ts": passing }, base), ["removed-test"]);
  assert.deepEqual(
    checksOf({ ...manifest, "tools/x/test/a.test.ts": passing, "tools/x/test/moved.test.ts": passing }, base),
    [],
  );
  assert.deepEqual(
    checksOf({ ...manifest, "tools/x/test/a.test.ts": passing + passing, "tools/x/test/b.test.ts": passing }, base),
    [],
  );
});

test("アサーションの無いテストを見つける", () => {
  const file = "tools/x/test/a.test.ts";
  assert.deepEqual(checksOf({ [file]: `test("a", () => {\n  run();\n});\n` }), ["hollow-test"]);
  assert.deepEqual(checksOf({ [file]: `test("a", async () => {\n  await assert.rejects(run());\n});\n` }), []);
  assert.deepEqual(
    checksOf({ [file]: `const ok = /x/.test(name);\n${passing}` }),
    [],
    "正規表現の .test( はテストではない",
  );
});

test("tsconfig の検査を緩める変更を見つける", () => {
  const file = "tools/x/tsconfig.json";
  const strict = `{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true, "erasableSyntaxOnly": true, "verbatimModuleSyntax": true }, "include": ["src", "test"] }`;
  assert.deepEqual(checksOf({ [file]: strict }, { [file]: strict }), []);
  assert.deepEqual(checksOf({ [file]: strict.replace(`"strict": true`, `"strict": false`) }, { [file]: strict }), [
    "loosened-tsconfig",
  ]);
  assert.deepEqual(checksOf({ [file]: strict.replace(`"noUncheckedIndexedAccess": true, `, "") }, { [file]: strict }), [
    "loosened-tsconfig",
    "loosened-tsconfig",
  ]);
  assert.deepEqual(checksOf({ [file]: strict.replace(`["src", "test"]`, `["src"]`) }, { [file]: strict }), [
    "loosened-tsconfig",
  ]);
  assert.deepEqual(
    checksOf({ [file]: strict.replace(`"include"`, `"exclude": ["src/a.ts"], "include"`) }, { [file]: strict }),
    ["loosened-tsconfig"],
  );
  assert.deepEqual(
    checksOf({ [file]: `// コメントと末尾のカンマは許す\n${strict.replace(` }, "include"`, `, }, "include"`)}` }),
    [],
  );
});

test("検査のスクリプトを無意味にする変更を見つける", () => {
  const file = "tools/x/package.json";
  const manifest = (test: string) => `{"scripts":{"typecheck":"tsc --noEmit","test":${JSON.stringify(test)}}}`;
  const base = { [file]: manifest("node --test test/*.test.ts") };
  assert.deepEqual(checksOf(base, base), []);
  assert.deepEqual(checksOf({ [file]: manifest("node --test test/*.test.ts || true") }, base), ["neutered-script"]);
  assert.deepEqual(checksOf({ [file]: manifest("echo skip") }, base), ["neutered-script", "neutered-script"]);
  assert.deepEqual(checksOf({ [file]: manifest("node --test test/a.test.ts") }, base), ["neutered-script"]);
  assert.deepEqual(checksOf({ [file]: `{"scripts":{"typecheck":"tsc --noEmit"}}` }, base), ["neutered-script"]);
  assert.deepEqual(checksOf({ "package.json": `{"scripts":{"test":"pnpm --filter @nagaya/x test"}}` }), [
    "neutered-script",
  ]);
  const root = { "package.json": `{"scripts":{"lint":"oxlint"}}` };
  assert.deepEqual(checksOf({ "package.json": `{"scripts":{"lint":"oxlint || true"}}` }, root), ["neutered-script"]);
  assert.deepEqual(checksOf({ "package.json": `{"scripts":{}}` }, root), ["neutered-script"]);
});

test("型エラーを黙らせるコメントを見つける", () => {
  assert.deepEqual(checksOf({ "tools/x/src/a.ts": `// @ts-ignore\nconst a: number = "x";\n` }), [
    "suppressed-type-error",
    "unplugged-package",
  ]);
  assert.deepEqual(checksOf({ "spikes/y/a.ts": `const text = "// @ts-ignore";\n` }), [], "文字列の中は見ない");
});

test("lint の設定を緩める変更を見つける", () => {
  const file = ".oxlintrc.json";
  const config = (extra = "") =>
    `{ "options": { "typeAware": true }, "categories": { "correctness": "error" }, "rules": { "no-unused-vars": ["error", {}], "typescript/no-floating-promises": "error" }, "overrides": [{ "files": ["**/test/**"], "rules": { "typescript/no-floating-promises": "off" } }], "ignorePatterns": ["spikes/**"]${extra} }`;
  const base = { [file]: config() };
  assert.deepEqual(checksOf(base, base), []);
  assert.deepEqual(
    checksOf(
      {
        [file]: config().replace(
          `"typescript/no-floating-promises": "error"`,
          `"typescript/no-floating-promises": "warn"`,
        ),
      },
      base,
    ),
    ["loosened-lint-config"],
  );
  assert.deepEqual(checksOf({ [file]: config().replace(`["error", {}]`, `"off"`) }, base), ["loosened-lint-config"]);
  assert.deepEqual(checksOf({ [file]: config().replace(`"correctness": "error"`, `"correctness": "warn"`) }, base), [
    "loosened-lint-config",
  ]);
  assert.deepEqual(
    checksOf(
      { [file]: config().replace(`"rules": { "no-unused-vars"`, `"rules": { "no-debugger": "off", "no-unused-vars"`) },
      base,
    ),
    ["loosened-lint-config"],
  );
  assert.deepEqual(checksOf({ [file]: config().replace(`["spikes/**"]`, `["spikes/**", "tools/**"]`) }, base), [
    "loosened-lint-config",
  ]);
  assert.deepEqual(checksOf({ [file]: config().replace(`"typeAware": true`, `"typeAware": false`) }, base), [
    "loosened-lint-config",
  ]);
  assert.deepEqual(checksOf({}, base), ["loosened-lint-config"]);
  assert.deepEqual(
    checksOf(
      {
        [file]: config().replace(
          `"typescript/no-floating-promises": "off"`,
          `"typescript/no-floating-promises": "off", "no-unused-vars": "off"`,
        ),
      },
      base,
    ),
    ["loosened-lint-config"],
    "全体で有効なルールを、overrides で切る",
  );
  assert.deepEqual(
    checksOf(
      {
        [file]: config().replace(
          `"typescript/no-floating-promises": "off"`,
          `"typescript/no-floating-promises": "off", "no-debugger": "off"`,
        ),
      },
      base,
    ),
    ["loosened-lint-config"],
    "カテゴリで有効なだけのルールを、overrides で切る",
  );
  assert.deepEqual(
    checksOf(
      {
        [file]: config()
          .replace(`"rules": { "no-unused-vars"`, `"rules": { "no-empty-function": "error", "no-unused-vars"`)
          .replace(
            `"typescript/no-floating-promises": "off"`,
            `"typescript/no-floating-promises": "off", "no-empty-function": "off"`,
          ),
      },
      base,
    ),
    [],
    "同じ変更で足したルールを、overrides で切るのは通す",
  );
  assert.deepEqual(
    checksOf(
      { [file]: `// コメントは許す\n${config().replace(`"no-unused-vars"`, `"eqeqeq": "error", "no-unused-vars"`)}` },
      base,
    ),
    [],
    "強める変更は通す",
  );
});

test("lint を黙らせるコメントは、行ごとで理由があるものだけを通す", () => {
  const code = (comment: string) => `${comment}\nexport const a = 1;\n`;
  const checks = (comment: string) => checksOf({ "spikes/y/a.ts": code(comment) });
  assert.deepEqual(checks("/* oxlint-disable */"), ["suppressed-lint"]);
  assert.deepEqual(checks("// eslint-disable no-console"), ["suppressed-lint"]);
  assert.deepEqual(checks("// oxlint-disable-next-line no-console"), ["suppressed-lint"]);
  assert.deepEqual(checks("// oxlint-disable-next-line no-console -- CLI の出力として使う"), []);
  assert.deepEqual(checksOf({ "spikes/y/a.ts": `const text = "// oxlint-disable";\n` }), [], "文字列の中は見ない");
});

test("パッケージが検査から外れる変更を見つける", () => {
  const workspace = `packages:\n  - "tools/*"\n  - "spikes/*"\n`;
  const files = {
    "pnpm-workspace.yaml": workspace,
    "tools/x/package.json": `{"scripts":{"typecheck":"tsc --noEmit"}}`,
    "tools/x/src/a.ts": "export {};\n",
  };
  assert.deepEqual(checksOf(files, files), []);
  assert.deepEqual(checksOf({ ...files, "pnpm-workspace.yaml": `packages:\n  - "spikes/*"\n` }, files), [
    "unplugged-package",
    "unplugged-package",
  ]);
  assert.deepEqual(checksOf({ ...files, "tools/x/package.json": `{"scripts":{}}` }), ["unplugged-package"]);
  const { "tools/x/package.json": _removed, ...withoutManifest } = files;
  assert.deepEqual(checksOf(withoutManifest), ["unplugged-package"]);
});
