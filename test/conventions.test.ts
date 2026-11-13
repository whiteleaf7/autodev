import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConventions } from "../src/checks/conventions.ts";
import { memoryRepo } from "../src/repo.ts";

const checksOf = (files: Record<string, string>) => checkConventions(memoryRepo(files)).map((p) => p.check);
const inSource = (code: string) => checksOf({ "tools/x/src/a.ts": code });

test("型としての any を見つけ、同じ綴りの別のものは通す", () => {
  for (const code of [
    "let a: any = 1;",
    "const a = b as any;",
    "const a: any[] = [];",
    "type A = Record<string, any>;",
    "function f(a: any): void {}",
    "const a = <any>b;",
  ]) {
    assert.deepEqual(inSource(code), ["explicit-any"], code);
  }
  for (const code of [
    "// any は使わない",
    'const a = "any";',
    "const a = { any: 1 };",
    "const a = z.any();",
    "const anyOf = 1;",
    "const a = /any/;",
  ]) {
    assert.deepEqual(inSource(code), [], code);
  }
  assert.deepEqual(checksOf({ "tools/x/public/a.js": "/** @type {any} */\nconst a = 1;\n" }), ["explicit-any"]);
  assert.deepEqual(checksOf({ "spikes/x/src/a.ts": "let a: any;" }), [], "spikes は対象にしない");
});

test("127.0.0.1 以外で待ち受けるサーバを見つける", () => {
  assert.deepEqual(inSource("server.listen(port);"), ["non-loopback-listen"]);
  assert.deepEqual(inSource('server.listen(port, "0.0.0.0", () => {});'), ["non-loopback-listen"]);
  assert.deepEqual(inSource("server.listen({ port });"), ["non-loopback-listen"]);
  assert.deepEqual(inSource("Bun.serve({ port: 3000, fetch });"), ["non-loopback-listen"]);
  assert.deepEqual(inSource('server.listen(port, "127.0.0.1", () => {});'), []);
  assert.deepEqual(inSource('const HOST = "127.0.0.1";\nserver.listen(port, HOST);'), []);
  assert.deepEqual(inSource('Bun.serve({ hostname: "127.0.0.1", port: 3000, fetch });'), []);
  assert.deepEqual(inSource('server.listen({ path: "/tmp/nagaya.sock" });'), []);
});

test("理由の無い空の catch を見つける", () => {
  assert.deepEqual(inSource("try { run(); } catch {}"), ["empty-catch"]);
  assert.deepEqual(inSource("try { run(); } catch (e) {\n}"), ["empty-catch"]);
  assert.deepEqual(inSource("await run().catch(() => {});"), ["empty-catch"]);
  assert.deepEqual(inSource("try { run(); } catch {\n  // まだ無い場合は監視しない\n}"), []);
  assert.deepEqual(inSource("try { run(); } catch {\n  return null;\n}"), []);
  assert.deepEqual(inSource("const res = await run().catch(() => null);"), []);
});

test("pnpm 以外のパッケージマネージャの実行を見つける", () => {
  const other = ["n", "px"].join("");
  assert.deepEqual(checksOf({ "tools/x/package.json": `{"scripts":{"lint":"${other} eslint ."}}` }), [
    "package-manager",
  ]);
  assert.deepEqual(checksOf({ "tools/x/package.json": `{"scripts":{"lint":"pnpm exec eslint ."}}` }), []);
  assert.deepEqual(checksOf({ "docs/a.md": `手順:\n\n\`\`\`sh\n${other} tsc --noEmit\n\`\`\`\n` }), [
    "package-manager",
  ]);
  assert.deepEqual(checksOf({ "docs/a.md": `\`${other} tsc\` を実行する\n` }), ["package-manager"]);
  assert.deepEqual(checksOf({ "docs/a.md": `${other} は使わない。pnpm を使う\n` }), [], "地の文での言及は構わない");
  assert.deepEqual(checksOf({ "tools/x/src/a.ts": `execFileSync("${other}", ["tsc"]);` }), ["package-manager"]);
});

test("import の循環を見つける", () => {
  const cyclic = checkConventions(
    memoryRepo({
      "tools/x/src/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
      "tools/x/src/b.ts": 'import type { C } from "./c.ts";\nexport const b = 1;\n',
      "tools/x/src/c.ts": 'export { a } from "./a.ts";\nexport type C = number;\n',
    }),
  );
  assert.deepEqual(
    cyclic.map((p) => p.check),
    ["circular-import"],
  );
  assert.match(cyclic[0]!.message, /a\.ts → .*b\.ts → .*c\.ts → .*a\.ts/);
  assert.deepEqual(
    checksOf({
      "tools/x/src/a.ts": 'import { b } from "./b.ts";\nconst lazy = await import("./c.ts");\n',
      "tools/x/src/b.ts": "export const b = 1;\n",
      "tools/x/src/c.ts": 'import { a } from "./a.ts";\n',
    }),
    [],
    "動的な import は循環に数えない",
  );
});
