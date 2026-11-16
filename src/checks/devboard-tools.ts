// ドキュメントと設定が指す MCP ツールの名前は、リポジトリに固定した一覧（devboard-tools.json）と照らす。
// CI には devboard が無いので一覧を持ち、devboard がある環境（ローカルのゲート）では、その一覧が古くなっていないことを確かめる

import type { Problem, Repo } from "../repo.ts";

export const TOOLS_FILE = "tools/harness/devboard-tools.json";

export function readToolsFile(repo: Repo): Set<string> | null {
  const text = repo.read(TOOLS_FILE);
  if (text === null) return null;
  try {
    const names: unknown = JSON.parse(text);
    return Array.isArray(names) ? new Set(names.filter((n): n is string => typeof n === "string")) : null;
  } catch {
    return null;
  }
}

// live は、いまの devboard が登録している名前。devboard が無い環境では null
export function checkDevboardTools(repo: Repo, live: string[] | null): Problem[] {
  const fixed = readToolsFile(repo);
  if (fixed === null) {
    return repo.read(TOOLS_FILE) === null
      ? []
      : [{ check: "stale-devboard-tools", file: TOOLS_FILE, message: "JSON の文字列の配列になっていない" }];
  }
  if (live === null) return [];
  const added = live.filter((name) => !fixed.has(name));
  const removed = [...fixed].filter((name) => !live.includes(name));
  if (!added.length && !removed.length) return [];
  const diff = [...added.map((n) => `+${n}`), ...removed.map((n) => `-${n}`)].join(" ");
  return [
    {
      check: "stale-devboard-tools",
      file: TOOLS_FILE,
      message: `devboard の MCP ツールと食い違っている（${diff}）。devboard tools の出力で、この一覧を書き直す`,
    },
  ];
}
