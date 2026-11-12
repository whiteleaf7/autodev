// CLAUDE.md の「コードの書き方」「作業ルール」のうち、型チェックでは拾えないものを検査する。
// 型の除去だけで消えない構文と、import の拡張子は、tsc（erasableSyntaxOnly、nodenext）が見ている。

import { posix } from "node:path";
import { isProductCode, isTestFile, packageDirs, parseJson, type Problem, type Repo } from "../repo.ts";
import { lineOf, matchingClose, scan } from "../source.ts";

// オブジェクトのキー（any:）と関数呼び出し（any(）は型ではないので除く
const ANY_TYPE = /(?<![\w$.])any(?![\w$])(?!\s*[:(])/g;
const ANY_IN_JSDOC = /@(type|param|returns?|typedef)\s*\{[^}]*\bany\b/g;
const SERVER_START = /(\.listen|\bBun\.serve|\bDeno\.serve|\bWebSocketServer)\s*\(/g;
const LOOPBACK = /["'`](127\.0\.0\.1|localhost|::1|\[::1\])["'`]/;
const ANY_INTERFACE = /["'`](0\.0\.0\.0|::|\[::\])["'`]/;
const UNIX_SOCKET = /\bpath\s*:|\.sock\b/;
const EMPTY_CATCH = /\bcatch\s*(\([^)]*\))?\s*\{\s*\}/g;
const EMPTY_PROMISE_CATCH = /\.catch\s*\(\s*(?:\(\s*[\w$]*\s*\)|[\w$]+)?\s*=>\s*\{\s*\}\s*\)/g;
const OTHER_PACKAGE_MANAGER = /(^|[^\w-])(npm|npx)(?![\w-])/;
const STATIC_IMPORT = /(?:^|[\s;])(?:import|export)\s(?:[^;'"`]*?\sfrom\s*)?["']([^"']+)["']/g;

function explicitAny(repo: Repo): Problem[] {
  return repo.files.filter(isProductCode).flatMap((file) => {
    const { code, comments } = scan(repo.read(file) ?? "");
    const typed = /\.(ts|tsx|mts|cts)$/.test(file) ? [...code.matchAll(ANY_TYPE)] : [];
    return [...typed, ...comments.matchAll(ANY_IN_JSDOC)].map((m) => ({
      check: "explicit-any",
      file,
      line: lineOf(code, m.index),
      message: "型に any を使っている。unknown にして絞り込むか、zod のスキーマから型を得る",
    }));
  });
}

// 引数に出てくる定数（const HOST = "127.0.0.1" など）の値も、引数の一部として読む
function withConstants(args: string, argsCode: string, fileText: string): string {
  const values = [...new Set(argsCode.match(/[A-Za-z_$][\w$]*/g) ?? [])].map(
    (name) => new RegExp(`\\bconst\\s+${name.replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*(["'\`][^"'\`]*["'\`])`).exec(fileText)?.[1] ?? "",
  );
  return [args, ...values].join(" ");
}

function nonLoopbackListen(repo: Repo): Problem[] {
  return repo.files.filter(isProductCode).flatMap((file) => {
    const { code, withStrings } = scan(repo.read(file) ?? "");
    return [...code.matchAll(SERVER_START)].flatMap((m) => {
      const open = m.index + m[0].length - 1;
      const close = matchingClose(code, open);
      if (close < 0) return [];
      const args = withConstants(withStrings.slice(open + 1, close), code.slice(open + 1, close), withStrings);
      if (!ANY_INTERFACE.test(args) && (LOOPBACK.test(args) || UNIX_SOCKET.test(args))) return [];
      return [{ check: "non-loopback-listen", file, line: lineOf(code, m.index), message: "サーバの待ち受けは 127.0.0.1 だけにする（ホストを省くと、すべてのインターフェースで待ち受ける）" }];
    });
  });
}

function emptyCatch(repo: Repo): Problem[] {
  return repo.files.filter(isProductCode).flatMap((file) => {
    const { code, comments } = scan(repo.read(file) ?? "");
    return [...code.matchAll(EMPTY_CATCH), ...code.matchAll(EMPTY_PROMISE_CATCH)]
      // 無視してよい理由をコメントで書いてあるものは、意図した判断として通す
      .filter((m) => !comments.slice(m.index, m.index + m[0].length).trim())
      .map((m) => ({
        check: "empty-catch",
        file,
        line: lineOf(code, m.index),
        message: "catch の中が空で、エラーを握りつぶしている。利用者が直せる言葉で返すか、投げ直す。無視してよいなら、理由をコメントに書く",
      }));
  });
}

function packageManager(repo: Repo): Problem[] {
  const problems: Problem[] = [];
  const add = (file: string, message: string, line?: number) => problems.push({ check: "package-manager", file, message, ...(line ? { line } : {}) });
  const advice = "パッケージマネージャは pnpm だけを使う（npm / npx の代わりに pnpm exec、pnpm dlx）";

  for (const dir of packageDirs(repo)) {
    const file = dir ? `${dir}/package.json` : "package.json";
    const json = parseJson(repo.read(file));
    const scripts = typeof json === "object" && json !== null ? (json as Record<string, unknown>).scripts : null;
    for (const [name, script] of Object.entries(typeof scripts === "object" && scripts !== null ? scripts : {})) {
      if (typeof script === "string" && OTHER_PACKAGE_MANAGER.test(script)) add(file, `スクリプト ${name}: ${advice}`);
    }
  }

  // Markdown は、コマンドとして書かれた箇所（コードブロックとインラインコード）だけを見る。地の文での言及は構わない
  for (const file of repo.files.filter((f) => f.endsWith(".md") && !f.startsWith("tools/harness/eval/"))) {
    let fenced = false;
    (repo.read(file) ?? "").split("\n").forEach((text, i) => {
      if (/^\s*(```|~~~)/.test(text)) fenced = !fenced;
      else if (fenced ? /^\s*([$>]\s+)?(sudo\s+)?(npm|npx)\s/.test(text) : /`(npm|npx)\s[^`]+`/.test(text)) add(file, advice, i + 1);
    });
  }

  for (const file of repo.files.filter((f) => isProductCode(f) && !isTestFile(f))) {
    const { withStrings } = scan(repo.read(file) ?? "");
    const m = /["'`](npm|npx)(["'`]|\s)/.exec(withStrings);
    if (m) add(file, advice, lineOf(withStrings, m.index));
  }
  for (const file of repo.files.filter((f) => f.startsWith(".githooks/") || f.endsWith(".sh"))) {
    (repo.read(file) ?? "").split("\n").forEach((text, i) => {
      if (!/^\s*#/.test(text) && /(^|[\s;&|(])(npm|npx)\s/.test(text)) add(file, advice, i + 1);
    });
  }
  return problems;
}

function circularImports(repo: Repo): Problem[] {
  const files = new Set(repo.files.filter(isProductCode));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const { withStrings } = scan(repo.read(file) ?? "");
    const targets = [...withStrings.matchAll(STATIC_IMPORT)]
      .map((m) => m[1]!)
      .filter((spec) => spec.startsWith("."))
      .map((spec) => posix.normalize(posix.join(posix.dirname(file), spec)))
      .map((path) => [path, `${path}.ts`, `${path}.js`, `${path}/index.ts`].find((candidate) => files.has(candidate)))
      .filter((target): target is string => target !== undefined);
    graph.set(file, targets);
  }

  const problems: Problem[] = [];
  const reported = new Set<string>();
  const done = new Set<string>();
  const visit = (file: string, path: string[]): void => {
    const at = path.indexOf(file);
    if (at >= 0) {
      const cycle = path.slice(at);
      const key = [...cycle].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        problems.push({ check: "circular-import", file: cycle[0]!, message: `import が循環している: ${[...cycle, file].join(" → ")}` });
      }
      return;
    }
    if (done.has(file)) return;
    for (const target of graph.get(file) ?? []) visit(target, [...path, file]);
    done.add(file);
  };
  for (const file of [...files].sort()) visit(file, []);
  return problems;
}

export function checkConventions(repo: Repo): Problem[] {
  return [...explicitAny(repo), ...nonLoopbackListen(repo), ...emptyCatch(repo), ...packageManager(repo), ...circularImports(repo)];
}
