// ドキュメントと設定が、リポジトリの実物（スクリプト、パス、決定記録、MCP ツール）からずれていないかを検査する。
// 「仕様や構成を変えたら、関係するドキュメントも同じ変更で直す」を機械的に確かめる。

import { posix } from "node:path";
import { packageDirs, parseJson, type Problem, type Repo } from "../repo.ts";

const isDoc = (path: string) => path === "CLAUDE.md" || path === "README.md" || /^docs\/.+\.md$/.test(path);

// スクリプトではなく pnpm 自身のコマンド
const PNPM_BUILTINS = new Set([
  "install", "i", "add", "remove", "rm", "uninstall", "update", "up", "upgrade", "dlx", "exec", "store", "why", "list", "ls",
  "outdated", "audit", "publish", "pack", "init", "create", "link", "unlink", "rebuild", "prune", "fetch", "config", "setup",
  "env", "patch", "deploy", "import", "approve-builds", "self-update", "dedupe", "root", "bin", "help",
]);
const PNPM_FLAGS = new Set(["-r", "--recursive", "--silent", "-s", "-w", "--workspace-root", "--parallel", "--if-present"]);
const PLACEHOLDER = /[<>*…{}]|\.\.\.|N{3,}/;
const REPO_PATH = /^(?:\.\/)?((?:docs|tools|dev|spikes|apps|packages|\.claude|\.githooks)\/[\w@.\-/[\]]*)$/;
const TOOL_NAME = /^(?:mcp__nagaya-dev__)?((?:get|list|create|update|set|open|add|search|delete|remove|record|find)_[a-z_]+)$/;

type Snippet = { text: string; line: number };

// コードとして書かれた部分（コードブロックの各行と、インラインコード）
function codeSnippets(text: string): Snippet[] {
  const snippets: Snippet[] = [];
  let fenced = false;
  text.split("\n").forEach((content, i) => {
    if (/^\s*(```|~~~)/.test(content)) fenced = !fenced;
    else if (fenced) snippets.push({ text: content, line: i + 1 });
    else for (const m of content.matchAll(/`([^`]+)`/g)) snippets.push({ text: m[1]!, line: i + 1 });
  });
  return snippets;
}

const clean = (token: string) => token.replace(/^["'(（「]+/, "").replace(/["')）」、。,;:]+$/, "");

type Facts = {
  rootScripts: Set<string>;
  packageScripts: Map<string, Set<string>>;
  decisions: Set<string>;
  tools: Set<string> | null;
  exists: (path: string) => boolean;
  ignored: (path: string) => boolean;
};

function gatherFacts(repo: Repo): Facts {
  const packageScripts = new Map<string, Set<string>>();
  let rootScripts = new Set<string>();
  for (const dir of packageDirs(repo)) {
    const json = parseJson(repo.read(dir ? `${dir}/package.json` : "package.json"));
    if (typeof json !== "object" || json === null) continue;
    const { name, scripts } = json as Record<string, unknown>;
    const names = new Set(Object.keys(typeof scripts === "object" && scripts !== null ? scripts : {}));
    if (!dir) rootScripts = names;
    if (typeof name === "string") packageScripts.set(name, names);
  }
  const mcp = repo.read("tools/devboard/src/mcp.ts");
  // .gitignore のうち、ワイルドカードを使わない行だけを読む（無視されるパスは、複製や他の環境には無い）
  const ignores = repo.files
    .filter((f) => f === ".gitignore" || f.endsWith("/.gitignore"))
    .flatMap((file) =>
      (repo.read(file) ?? "")
        .split("\n")
        .map((line) => line.trim().replace(/^\//, "").replace(/\/$/, ""))
        .filter((line) => line && !line.startsWith("#") && !line.startsWith("!") && !line.includes("*"))
        .map((entry) => ({ dir: file.slice(0, -".gitignore".length), entry })),
    );
  const files = new Set(repo.files);
  return {
    rootScripts,
    packageScripts,
    decisions: new Set(repo.files.map((f) => /^docs\/decisions\/(\d{4})-/.exec(f)?.[1]).filter((n): n is string => Boolean(n))),
    tools: mcp === null ? null : new Set([...mcp.matchAll(/registerTool\(\s*"([^"]+)"/g)].map((m) => m[1]!)),
    exists: (path) => {
      const trimmed = path.replace(/\/$/, "");
      return files.has(trimmed) || repo.files.some((f) => f.startsWith(`${trimmed}/`));
    },
    ignored: (path) =>
      ignores.some(({ dir, entry }) => {
        if (!path.startsWith(dir)) return false;
        const inner = path.slice(dir.length).replace(/\/$/, "");
        // スラッシュを含まない行は、どの深さにあっても効く
        return entry.includes("/") ? inner === entry || inner.startsWith(`${entry}/`) : inner.split("/").includes(entry);
      }),
  };
}

// 「pnpm ...」が指すスクリプトが無ければ、その説明を返す
function missingScript(command: string, facts: Facts): string | null {
  const tokens = command.trim().split(/\s+/).map(clean);
  let filter: string | null = null;
  let i = 0;
  while (i < tokens.length && tokens[i]!.startsWith("-")) {
    const flag = tokens[i]!;
    if (flag === "--filter" || flag === "-F") {
      filter = tokens[i + 1] ?? null;
      i += 2;
    } else if (flag.startsWith("--filter=")) {
      filter = flag.slice("--filter=".length);
      i++;
    } else if (PNPM_FLAGS.has(flag)) i++;
    else return null; // 知らないフラグの先は読まない
  }
  const script = tokens[i] === "run" ? tokens[i + 1] : tokens[i];
  if (!script || !/^[a-z][\w:.-]*$/i.test(script) || (tokens[i] !== "run" && PNPM_BUILTINS.has(script))) return null;
  if (filter === null) return facts.rootScripts.has(script) ? null : `ルートの package.json に ${script} というスクリプトが無い`;
  if (PLACEHOLDER.test(filter)) return null;
  const own = facts.packageScripts.get(filter);
  if (!own) return `${filter} というパッケージが無い`;
  return own.has(script) ? null : `${filter} に ${script} というスクリプトが無い`;
}

function checkDoc(file: string, text: string, facts: Facts): Problem[] {
  const problems: Problem[] = [];
  // 決定記録は、その時点の判断の記録。あとで消えたり移ったりしたパスに触れていても正しい
  const historical = file.startsWith("docs/decisions/");
  const add = (check: string, line: number, message: string) => {
    if (!(historical && check === "missing-path")) problems.push({ check, file, line, message });
  };

  for (const { text: snippet, line } of codeSnippets(text)) {
    for (const m of snippet.matchAll(/(?<![\w-])pnpm\s+([^|;&`]+)/g)) {
      const missing = missingScript(m[1]!, facts);
      if (missing) add("missing-script", line, missing);
    }
    for (const token of snippet.split(/\s+/).map(clean)) {
      const path = REPO_PATH.exec(token.replace(/(:\d+(-\d+)?|#L\d+)$/, ""))?.[1];
      if (!path || PLACEHOLDER.test(path) || facts.ignored(path)) continue;
      // まだ作っていない最上位のディレクトリ（apps/ など）は、予定として書かれている
      if (facts.exists(path.split("/")[0]!) && !facts.exists(path)) add("missing-path", line, `${path} が存在しない`);
    }
    const tool = TOOL_NAME.exec(snippet.trim())?.[1];
    if (tool && facts.tools && !facts.tools.has(tool)) add("missing-mcp-tool", line, `MCP ツール ${tool} は nagaya-dev に登録されていない`);
  }

  text.split("\n").forEach((content, i) => {
    for (const m of content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1]!.replace(/#.*$/, "");
      if (!target || /^([a-z][a-z0-9+.-]*:|\/)/i.test(target)) continue;
      const path = posix.normalize(posix.join(posix.dirname(file), target));
      if (!path.startsWith("..") && !facts.ignored(path) && !facts.exists(path)) add("missing-path", i + 1, `リンク先の ${path} が存在しない`);
    }
    const numbers = [...content.matchAll(/決定記録[^\d\n]{0,6}(\d{4})/g), ...content.matchAll(/[（(](0\d{3})[）)]/g)].map((m) => m[1]!);
    for (const number of new Set(numbers)) {
      if (!facts.decisions.has(number)) add("missing-decision", i + 1, `決定記録 ${number} が存在しない`);
    }
  });
  return problems;
}

function checkConfig(repo: Repo, facts: Facts): Problem[] {
  const problems: Problem[] = [];
  const mcp = parseJson(repo.read(".mcp.json"));
  const servers = typeof mcp === "object" && mcp !== null ? ((mcp as Record<string, unknown>).mcpServers ?? {}) : {};
  for (const [name, server] of Object.entries(typeof servers === "object" && servers !== null ? servers : {})) {
    const args: unknown = typeof server === "object" && server !== null ? (server as Record<string, unknown>).args : [];
    for (const arg of Array.isArray(args) ? args : []) {
      if (typeof arg === "string" && /^[^-].*\.(ts|js|mjs|cjs|json)$/.test(arg) && !facts.exists(posix.normalize(arg))) {
        problems.push({ check: "broken-config", file: ".mcp.json", message: `${name} が指す ${arg} が存在しない` });
      }
    }
  }

  const settingsText = repo.read(".claude/settings.json");
  const settings = parseJson(settingsText);
  if (settingsText !== null && facts.tools) {
    for (const m of settingsText.matchAll(/mcp__nagaya-dev__([\w-]+)/g)) {
      if (!facts.tools.has(m[1]!)) problems.push({ check: "missing-mcp-tool", file: ".claude/settings.json", message: `MCP ツール ${m[1]} は nagaya-dev に登録されていない` });
    }
  }
  const enabled: unknown = typeof settings === "object" && settings !== null ? (settings as Record<string, unknown>).enabledMcpjsonServers : [];
  for (const name of Array.isArray(enabled) ? enabled : []) {
    if (typeof name === "string" && typeof servers === "object" && servers !== null && !(name in servers)) {
      problems.push({ check: "broken-config", file: ".claude/settings.json", message: `有効にしている MCP サーバ ${name} が .mcp.json に無い` });
    }
  }
  return problems;
}

export function checkDocs(repo: Repo): Problem[] {
  const facts = gatherFacts(repo);
  return [...repo.files.filter(isDoc).flatMap((file) => checkDoc(file, repo.read(file) ?? "", facts)), ...checkConfig(repo, facts)];
}
