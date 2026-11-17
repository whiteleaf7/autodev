// このパッケージを git 依存（node_modules の中）として使うプロジェクトのテストで、読み込む。
//   node --import autodev/verify/register.js --test test/*.test.ts
// Node は、node_modules の中の .ts の型を剥がして実行しない（ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING）。
// autodev/verify/ の .ts だけは、node_modules の中でも、型を剥がして読めるようにする。

import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const OWN_TYPESCRIPT = /\/node_modules\/autodev\/verify\/.+\.ts$/;

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !OWN_TYPESCRIPT.test(url)) return nextLoad(url, context);
    const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "strip" });
    return { format: "module", source, shortCircuit: true };
  },
});
