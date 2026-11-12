import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDocs } from "../src/checks/docs.ts";
import { memoryRepo } from "../src/repo.ts";

const repoFiles = {
  "package.json": `{"name":"nagaya","scripts":{"test":"pnpm -r test","board":"pnpm --filter @nagaya/devboard start"}}`,
  "tools/devboard/package.json": `{"name":"@nagaya/devboard","scripts":{"start":"node src/server.ts"}}`,
  "tools/devboard/src/mcp.ts": `server.registerTool(\n  "get_overview",\n  {});\nserver.registerTool("create_task", {});\n`,
  "docs/product.md": "# プロダクト\n",
  "docs/decisions/0001-first.md": "# 0001. 最初\n",
  ".gitignore": ".dev/\nnode_modules/\n",
  "spikes/shell/.gitignore": "build/\n",
  "spikes/shell/src/index.ts": "export {};\n",
};

const checksOf = (doc: string, extra: Record<string, string> = {}) =>
  checkDocs(memoryRepo({ ...repoFiles, "CLAUDE.md": doc, ...extra })).map((p) => p.check);

test("無い pnpm スクリプトへの言及を見つける", () => {
  assert.deepEqual(checksOf("テストは `pnpm test`、ボードは `pnpm board`\n"), []);
  assert.deepEqual(checksOf("リントは `pnpm lint`\n"), ["missing-script"]);
  assert.deepEqual(checksOf("```sh\npnpm --filter @nagaya/devboard start\npnpm --filter @nagaya/devboard open\n```\n"), ["missing-script"]);
  assert.deepEqual(checksOf("`pnpm --filter @nagaya/unknown start`\n"), ["missing-script"]);
  assert.deepEqual(checksOf("`pnpm install` と `pnpm dlx electrobun` と `pnpm --filter @nagaya/* ...`\n"), [], "pnpm 自身のコマンドと、例示の書き方は通す");
  assert.deepEqual(checksOf("pnpm workspace を使う\n"), [], "地の文は見ない");
});

test("無いパスへの言及を見つける", () => {
  assert.deepEqual(checksOf("`docs/product.md` と `tools/devboard/src/mcp.ts` と `docs/decisions/`\n"), []);
  assert.deepEqual(checksOf("`docs/products.md` を読む\n"), ["missing-path"]);
  assert.deepEqual(checksOf("[プロダクト](docs/products.md) と [外部](https://example.com/) と [隣](../paseo/README.md)\n"), ["missing-path"]);
  assert.deepEqual(checksOf("```sh\nnode tools/devboard/src/missing.ts\n```\n"), ["missing-path"]);
  assert.deepEqual(
    checksOf("`.dev/verify/` と `spikes/shell/build/app` と `docs/decisions/NNNN-slug.md` と `dev/tasks/*.json` と `apps/desktop/src`\n"),
    [],
    "無視されるパス、例示、これから作るディレクトリは通す",
  );
});

test("無い決定記録と、登録されていない MCP ツールへの言及を見つける", () => {
  assert.deepEqual(checksOf("経緯は決定記録 0001 にある（0001）\n"), []);
  assert.deepEqual(checksOf("経緯は決定記録 0002 にある\n"), ["missing-decision"]);
  assert.deepEqual(checksOf("対応 OS（0007）\n"), ["missing-decision"]);
  assert.deepEqual(checksOf("`get_overview` と `create_task` を使う。状態は `doing`\n"), []);
  assert.deepEqual(checksOf("`get_summary` を使う\n"), ["missing-mcp-tool"]);
});

test("設定が指すものが無ければ見つける", () => {
  const settings = (tool: string) => `{"enabledMcpjsonServers":["nagaya-dev"],"permissions":{"allow":["mcp__nagaya-dev__${tool}"]}}`;
  const mcp = (file: string) => `{"mcpServers":{"nagaya-dev":{"command":"node","args":["${file}"]}}}`;
  const ok = { ".mcp.json": mcp("tools/devboard/src/mcp.ts"), ".claude/settings.json": settings("get_overview") };
  assert.deepEqual(checksOf("# 開発\n", ok), []);
  assert.deepEqual(checksOf("# 開発\n", { ...ok, ".mcp.json": mcp("tools/devboard/src/gone.ts") }), ["broken-config"]);
  assert.deepEqual(checksOf("# 開発\n", { ...ok, ".claude/settings.json": settings("get_summary") }), ["missing-mcp-tool"]);
  assert.deepEqual(checksOf("# 開発\n", { ...ok, ".mcp.json": `{"mcpServers":{}}` }), ["broken-config"]);
});
