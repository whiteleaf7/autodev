import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConventions } from "../src/checks/conventions.ts";
import { memoryRepo } from "../src/repo.ts";

const checksOf = (files: Record<string, string>) => checkConventions(memoryRepo(files)).map((p) => p.check);
const inSource = (code: string) => checksOf({ "tools/x/src/a.ts": code });

test("JSDoc の型に書いた any を見つける", () => {
  assert.deepEqual(checksOf({ "tools/x/public/a.js": "/** @type {any} */\nconst a = 1;\n" }), ["explicit-any"]);
  assert.deepEqual(checksOf({ "tools/x/public/a.js": "/** @param {string} any */\nconst a = 1;\n" }), []);
  assert.deepEqual(checksOf({ "spikes/x/a.js": "/** @type {any} */\nconst a = 1;\n" }), [], "spikes は対象にしない");
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
