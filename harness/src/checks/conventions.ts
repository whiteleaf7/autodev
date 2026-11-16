// CLAUDE.md の「コードの書き方」「作業ルール」のうち、型チェックと lint では拾えないものを検査する。
// 型の除去だけで消えない構文と、import の拡張子は tsc（erasableSyntaxOnly、nodenext）が、
// any・空の catch・import の循環は oxlint（.oxlintrc.json）が見ている（決定記録 0013）。

import { isProductCode, isTestFile, packageDirs, parseJson, type Problem, type Repo } from "../repo.ts";
import { lineOf, matchingClose, scan } from "../source.ts";

// oxlint は JSDoc の型を読まないので、checkJs の JS に書いた any はここで見る
const ANY_IN_JSDOC = /@(type|param|returns?|typedef)\s*\{[^}]*\bany\b/g;
const SERVER_START = /(\.listen|\bBun\.serve|\bDeno\.serve|\bWebSocketServer)\s*\(/g;
const LOOPBACK = /["'`](127\.0\.0\.1|localhost|::1|\[::1\])["'`]/;
const ANY_INTERFACE = /["'`](0\.0\.0\.0|::|\[::\])["'`]/;
const UNIX_SOCKET = /\bpath\s*:|\.sock\b/;
const OTHER_PACKAGE_MANAGER = /(^|[^\w-])(npm|npx)(?![\w-])/;

function anyInJsDoc(repo: Repo): Problem[] {
  return repo.files.filter(isProductCode).flatMap((file) => {
    const { comments } = scan(repo.read(file) ?? "");
    return [...comments.matchAll(ANY_IN_JSDOC)].map((m) => ({
      check: "explicit-any",
      file,
      line: lineOf(comments, m.index),
      message: "JSDoc の型に any を使っている。具体的な型か unknown にする",
    }));
  });
}

// 引数に出てくる定数（const HOST = "127.0.0.1" など）の値も、引数の一部として読む
function withConstants(args: string, argsCode: string, fileText: string): string {
  const values = [...new Set(argsCode.match(/[A-Za-z_$][\w$]*/g) ?? [])].map(
    (name) =>
      new RegExp(`\\bconst\\s+${name.replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*(["'\`][^"'\`]*["'\`])`).exec(
        fileText,
      )?.[1] ?? "",
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
      return [
        {
          check: "non-loopback-listen",
          file,
          line: lineOf(code, m.index),
          message: "サーバの待ち受けは 127.0.0.1 だけにする（ホストを省くと、すべてのインターフェースで待ち受ける）",
        },
      ];
    });
  });
}

function packageManager(repo: Repo): Problem[] {
  const problems: Problem[] = [];
  const add = (file: string, message: string, line?: number) =>
    problems.push({ check: "package-manager", file, message, ...(line ? { line } : {}) });
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
  for (const file of repo.files.filter((f) => f.endsWith(".md") && !f.startsWith(".autodev/eval/"))) {
    let fenced = false;
    (repo.read(file) ?? "").split("\n").forEach((text, i) => {
      if (/^\s*(```|~~~)/.test(text)) fenced = !fenced;
      else if (fenced ? /^\s*([$>]\s+)?(sudo\s+)?(npm|npx)\s/.test(text) : /`(npm|npx)\s[^`]+`/.test(text))
        add(file, advice, i + 1);
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

export function checkConventions(repo: Repo): Problem[] {
  return [...anyInJsDoc(repo), ...nonLoopbackListen(repo), ...packageManager(repo)];
}
