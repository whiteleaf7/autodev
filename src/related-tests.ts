// 変異を入れたファイルに届くテストを、相対パスの参照（import と、子プロセスに渡すパスの文字列）から探す。
// 変異テストは、これらを先に回して早く止め、通ったときだけパッケージのテストを全部回す。

import { dirname, join, normalize } from "node:path";
import type { Tree } from "./repo.ts";
import { scan } from "./source.ts";

const RELATIVE_PATH = /(["'`])(\.\.?\/[^"'`\s$]+)\1/g;

function referencesOf(file: string, text: string): string[] {
  const { withStrings } = scan(text);
  return [...withStrings.matchAll(RELATIVE_PATH)].map((m) => normalize(join(dirname(file), m[2]!)));
}

// packageDir の test/*.test.ts のうち、参照をたどって target に届くもの（packageDir からの相対パス）
export function testsReaching(tree: Tree, packageDir: string, target: string): string[] {
  const prefix = `${packageDir}/`;
  const tests = tree.files.filter((f) => f.startsWith(`${prefix}test/`) && f.endsWith(".test.ts"));
  const reaches = (test: string) => {
    const seen = new Set([test]);
    const queue = [test];
    while (queue.length) {
      const file = queue.pop()!;
      if (file === target) return true;
      for (const next of referencesOf(file, tree.read(file) ?? "")) {
        if (!seen.has(next) && tree.files.includes(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  return tests.filter(reaches).map((f) => f.slice(prefix.length));
}
