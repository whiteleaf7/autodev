// autodev コマンドのサブコマンドと、それを実行するスクリプトの対応。
// どのスクリプトも、コマンドを打った場所（cwd）のプロジェクトを対象にする

const COMMANDS = {
  init: { script: "harness/src/init.ts", summary: "新しいプロジェクトに、autodev を使う設定と文書の雛形を書いて、初期化する" },
  check: { script: "harness/src/check.ts", summary: "ゲート（評価の緩め・規約・記録・ドキュメントの検査のあと、lint・型チェック・テスト）。--staged で index を検査する" },
  hook: { script: "harness/src/hook.ts", summary: "git のフックの本体（pre-commit・commit-msg・pre-push）。フックの設定から呼ぶ" },
  land: { script: "harness/src/land.ts", summary: "作業ブランチを、rebase → ゲート → PR → CI → マージで main に取り込む" },
  prune: { script: "harness/src/prune.ts", summary: "取り込み済みの作業用 worktree を片付ける" },
  eval: { script: "harness/src/eval.ts", summary: "ハーネスの評価（--set public | heldout、--family、--validate、--record）" },
  mutate: { script: "harness/src/mutate.ts", summary: "変異テスト（テストの抜けを探す）" },
  "rules-sync": { script: "harness/src/rules-sync.ts", summary: "AGENTS.md の共通の規約の区画を、共通の規約の本文で作り直す" },
  "stop-hook": { script: "harness/src/stop-hook.ts", summary: "エージェントの Stop フックの本体（確認を頼む返答を差し戻す）" },
  "roborev-doctor": { script: "harness/src/roborev-doctor.ts", summary: "roborev の状態を調べて、問題があれば知らせる" },
  screenshot: { script: "verify/src/screenshot.ts", summary: "ヘッドレス Chrome で Web の画面を撮る" },
  windows: { script: "verify/src/windows.swift", runner: "swift", summary: "macOS のウィンドウの一覧を出す（ネイティブのアプリの確認用）" },
} as const;

export const USAGE = [
  "使い方: autodev <コマンド> [引数...]",
  "対象は、コマンドを打った場所の git の作業ツリー。AUTODEV_ROOT で別の場所を指せる",
  "",
  ...Object.entries(COMMANDS).map(([name, { summary }]) => `  ${name.padEnd(16)}${summary}`),
].join("\n");

export type Resolved = { ok: true; script: string; runner: string | null; args: string[] } | { ok: false; message: string; help: boolean };

export function resolveCommand(argv: readonly string[]): Resolved {
  const [name, ...args] = argv;
  if (name === undefined || name === "help" || name === "-h" || name === "--help") {
    return { ok: false, message: USAGE, help: true };
  }
  if (!Object.hasOwn(COMMANDS, name)) {
    return { ok: false, message: `${name} というコマンドは無い\n\n${USAGE}`, help: false };
  }
  const command: { script: string; runner?: string } = COMMANDS[name as keyof typeof COMMANDS];
  return { ok: true, script: command.script, runner: command.runner ?? null, args };
}
