import { test } from "node:test";
import assert from "node:assert/strict";
import { testsReaching } from "../src/related-tests.ts";
import { memoryRepo } from "../src/repo.ts";

const repo = memoryRepo({
  "pkg/src/a.ts": 'import { b } from "./b.ts";\n',
  "pkg/src/b.ts": "export const b = 1;\n",
  "pkg/src/unused.ts": "export const unused = 1;\n",
  "pkg/src/cli.ts": 'import { a } from "./a.ts";\n',
  "pkg/public/view.js": "export const view = 1;\n",
  "pkg/test/helper.ts": 'export { a } from "../src/a.ts";\n',
  "pkg/test/a.test.ts": 'import { a } from "./helper.ts";\n',
  "pkg/test/cli.test.ts": 'spawn("node", [join(import.meta.dirname, "../src/cli.ts")]);\n',
  "pkg/test/view.test.ts": 'import { view } from "../public/view.js";\n// "../src/b.ts" はコメントなので数えない\n',
  "other/test/b.test.ts": 'import { b } from "../../pkg/src/b.ts";\n',
});

test("import と、子プロセスに渡すパスをたどって、届くテストだけを返す", () => {
  assert.deepEqual(testsReaching(repo, "pkg", "pkg/src/b.ts"), ["test/a.test.ts", "test/cli.test.ts"]);
  assert.deepEqual(testsReaching(repo, "pkg", "pkg/src/cli.ts"), ["test/cli.test.ts"]);
  assert.deepEqual(testsReaching(repo, "pkg", "pkg/public/view.js"), ["test/view.test.ts"]);
});

test("どのテストからも届かないファイルには、空を返す", () => {
  assert.deepEqual(testsReaching(repo, "pkg", "pkg/src/unused.ts"), []);
});

test("ルートのパッケージ（\".\"）でも、届くテストを見つける（接頭辞に ./ を付けると 1 件も見つからなかった）", () => {
  const root = memoryRepo({
    "src/a.ts": "export const a = 1;\n",
    "test/a.test.ts": 'import { a } from "../src/a.ts";\n',
    "test/other.test.ts": "// どこにも届かない\n",
  });
  assert.deepEqual(testsReaching(root, ".", "src/a.ts"), ["test/a.test.ts"]);
});
