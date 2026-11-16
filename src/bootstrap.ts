// 自律開発基盤（harness・verify・フック・CI・AGENTS.md / CLAUDE.md。devboard は共有のコマンド）を新しいディレクトリへ展開して初期化する。
//   node bootstrap.ts <対象ディレクトリ> [--name <プロジェクト名>] [--title <製品表示名>] [--summary <概要>] [--files-only] [--source <展開元>]
//   node bootstrap.ts --export-base <出力先> [--source <展開元>]    展開元（init-autodev スキルの base/）を作る
// 展開元は、既定ではこのファイルがあるディレクトリの根。init-autodev スキルは、特定のプロジェクトに頼らないよう、自分の base/ に展開元を持つ。

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { renderRegion } from "./rules-region.ts";

// このファイルがある基盤の根。プロジェクトの中なら、そのプロジェクト。スキルの base/ の中なら、base/
const DEFAULT_SOURCE_ROOT = resolve(import.meta.dirname, "../../..");

const USAGE =
  "使い方: bootstrap <対象ディレクトリ> [--name <プロジェクト名>] [--title <製品表示名>] [--summary <概要>] [--files-only] [--source <展開元>]\n        bootstrap --export-base <出力先> [--source <展開元>]";

export type BootstrapOptions = {
  targetDir: string;
  name: string;
  title: string;
  summary: string;
  filesOnly: boolean;
  // 展開元の根。省くと、このファイルがある基盤の根
  sourceRoot?: string;
};

export function toPascalCase(slug: string): string {
  return (
    slug
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join("") || slug
  );
}

export function parseBootstrapArgs(argv: string[]): BootstrapOptions {
  let targetArg: string | undefined;
  let name: string | undefined;
  let title: string | undefined;
  let summary: string | undefined;
  let filesOnly = false;
  let sourceArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${arg} の値が無い\n${USAGE}`);
      return v;
    };
    if (arg === "--name") name = next();
    else if (arg === "--title") title = next();
    else if (arg === "--summary") summary = next();
    else if (arg === "--files-only") filesOnly = true;
    else if (arg === "--source") sourceArg = next();
    else if (arg.startsWith("-")) throw new Error(`知らない引数: ${arg}\n${USAGE}`);
    else if (!targetArg) targetArg = arg;
    else throw new Error(`対象ディレクトリが複数渡されている: ${arg}\n${USAGE}`);
  }
  if (!targetArg) throw new Error(USAGE);
  const targetDir = resolve(process.env.INIT_CWD ?? process.cwd(), targetArg);
  const resolvedName = (name ?? basename(targetDir)).trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(resolvedName)) {
    throw new Error(`プロジェクト名には英数字・ハイフン・アンダースコアを使う: ${resolvedName}`);
  }
  const resolvedTitle = (title ?? toPascalCase(resolvedName)).trim();
  return {
    targetDir,
    name: resolvedName,
    title: resolvedTitle,
    summary: summary ?? `${resolvedTitle}（${resolvedName}）`,
    filesOnly,
    sourceRoot: sourceArg ? resolve(process.env.INIT_CWD ?? process.cwd(), sourceArg) : undefined,
  };
}

const ROOT_FILES = [
  ".node-version",
  ".gitignore",
  ".git-blame-ignore-revs",
  ".oxlintrc.json",
  "biome.json",
  "paseo.json",
  ".mcp.json",
  ".devboard.json",
  ".claude/settings.json",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".github/workflows/check.yml",
  "docs/harness.md",
] as const;

const VERIFY_FILES = [
  "src/chrome.ts",
  "src/options.ts",
  "src/screenshot.ts",
  "src/windows.swift",
  "test/screenshot.test.ts",
  "tsconfig.json",
  "settings.local.example.json",
] as const;

const ENV_DECISIONS = [
  "0001-in-repo-devboard-and-mcp.md",
  "0008-verify-ui-with-headless-chrome.md",
  "0009-harness-gate-and-eval.md",
  "0010-parallel-worktrees.md",
  "0011-board-in-sqlite.md",
  "0012-roborev-review.md",
  "0013-lint-format-ci.md",
  "0014-remote-and-ci.md",
  "0015-land-through-pull-requests.md",
  "0017-activity-page.md",
  "0038-read-only-devboard.md",
] as const;

// 最終評価用のシナリオ（heldout）は、新しいプロジェクトに持ち込まない
const skipHeldout = (rel: string) => rel.startsWith("eval/heldout/") && rel !== "eval/heldout/.gitkeep";

function copyTreeFiltered(fromDir: string, toDir: string, skip?: (rel: string) => boolean, relBase = ""): void {
  mkdirSync(toDir, { recursive: true });
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".DS_Store") continue;
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (skip?.(rel)) continue;
    const src = join(fromDir, entry.name);
    const dst = join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeFiltered(src, dst, skip, rel);
    } else if (entry.isFile()) {
      cpSync(src, dst);
      const mode = lstatSync(src).mode;
      if (mode & 0o111) chmodSync(dst, mode);
    }
  }
}

export function renderPackageJson(name: string, title: string, sourceRoot = DEFAULT_SOURCE_ROOT): string {
  const rootPkg = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")) as Record<string, unknown>;
  return `${JSON.stringify(
    {
      name,
      displayName: title,
      private: true,
      type: "module",
      packageManager: rootPkg.packageManager,
      engines: rootPkg.engines,
      scripts: {
        board: "devboard start",
        "board:open": "devboard open",
        "board:tailscale": "devboard tailscale",
        "board:import": "devboard import-history",
        "board:show": "devboard show",
        "board:apply": "devboard apply",
        typecheck: "pnpm -r typecheck",
        test: "pnpm -r test",
        check: "node tools/harness/src/check.ts",
        format: "biome format --write",
        lint: "oxlint",
        recall: "devboard recall",
        land: "node tools/harness/src/land.ts",
        "worktree:prune": "node tools/harness/src/prune.ts",
        "harness:eval": "node tools/harness/src/eval.ts",
        "harness:selftest": "node tools/harness/src/eval.ts --set public",
        "harness:mutate": "node tools/harness/src/mutate.ts",
        bootstrap: "node tools/harness/src/bootstrap.ts",
        prepare: "git config core.hooksPath .githooks && git config blame.ignoreRevsFile .git-blame-ignore-revs",
      },
      devDependencies: rootPkg.devDependencies,
    },
    null,
    2,
  )}\n`;
}

// 共通の規約（tools/harness/rules/common.md）は、管理される区画として入れる。固有の記述は、区画の外に書く
export function renderAgentGuide(name: string, title: string, common: string): string {
  return `# ${title} (${name})

**${title}**（リポジトリ名 \`${name}\`）。AI エージェント（Claude Code、Codex、Gemini など）が自律して開発を進めるための基盤（開発ボード・MCP / CLI・ハーネス・画面確認ツール）を備えたプロジェクト。
エージェント向けの手引きは \`AGENTS.md\` に置いてある。\`CLAUDE.md\` は \`@AGENTS.md\` と書くだけで、同じ内容を読み込む。

## まず読む

- 作業を始めるときは、MCP \`devboard\` の \`get_overview\`（MCP が無い環境では \`pnpm board:show overview\`）で現在のマイルストーンと進行中のタスクを確認する
- \`docs/product.md\`: 何を作るか、未決事項
- \`docs/architecture.md\`: 構成とリポジトリの配置
- \`docs/decisions/\`: 決定記録。設計に関わる作業の前に、関係するものを読む
- \`docs/verification.md\`: 動かして確かめる手段（画面の撮影、ウィンドウの一覧）と、ユーザーに一度だけしてもらう準備
- \`docs/harness.md\`: コミット前のゲート、フック、worktree の取り込み、記録の検索、ハーネスの評価のしかた

${renderRegion(common)}

## コマンド

- 型チェック: \`pnpm typecheck\`
- 整形: \`pnpm format\`（コミットのときは pre-commit が自動で整形する）
- lint: \`pnpm lint\`（oxlint。型情報つき）
- テスト: \`pnpm test\`
- ダッシュボード: \`pnpm board\`（前面）/ \`pnpm board:open\`（裏で起動してブラウザで開く）
- ボードの読み書き（CLI）: \`pnpm board:show\`（overview・tasks・task・decisions・decision）/ \`pnpm board:apply '<JSON>'\`
- ゲート: \`pnpm check\`（評価の緩め・規約・記録・ドキュメントの検査のあと、lint・型チェック・テスト。\`docs/harness.md\`）
- 記録を探す: \`pnpm recall "<質問>"\`
- ボードを git の履歴から再現する: \`pnpm board:import\`（空のボードにだけ入れる。置き場所は \`DEVBOARD_DB\` で変えられる）
- ブランチを PR で main に取り込む: \`pnpm land\`（main 以外のブランチの上で）/ 片付け: \`pnpm worktree:prune\`
- ハーネスの評価: \`pnpm harness:selftest\`（公開用のシナリオ）/ \`pnpm harness:eval --set heldout --record\`（最終評価用。集計だけを見る）
- 新規プロジェクトへの基盤展開: \`pnpm bootstrap <対象ディレクトリ> [--name <プロジェクト名>] [--title <製品名>]\`
- 共通の規約（上の区画）の更新: \`node tools/harness/src/rules-sync.ts [--from <common.md>]\`（init-autodev スキルの base/ から更新するときは \`--from\` に base/ の \`tools/harness/rules/common.md\` を渡す）
`;
}

export function renderReadme(name: string, title: string): string {
  return `# ${title} (\`${name}\`)

**${title}**（リポジトリ名 \`${name}\`）は、AI エージェント（Claude Code、Codex、Gemini など）が自律して開発を進めるための仕組み（開発ボード・MCP / CLI・ハーネス・自動検証）を備えたプロジェクトです。

## 必要環境

- macOS
- Node.js \`>= 24\`（\`.node-version\` 参照）
- \`pnpm\`（\`corepack enable\` で \`package.json\` の \`packageManager\` を使用）

## セットアップ

\`\`\`sh
pnpm install
\`\`\`

\`pnpm install\` の \`prepare\` スクリプトにより、\`.githooks\` が Git フックとして設定されます。

## 開発コマンド

\`\`\`sh
# ゲート（規約・記録・ドキュメント・lint・型チェック・テストを一括実行）
pnpm check

# 開発ボード（Web ダッシュボード）の起動
pnpm board
pnpm board:open
pnpm board:tailscale

# 開発ボードの CLI 読み書き（MCP を使わないエージェント・シェル用）
pnpm board:show
pnpm board:apply '[...]'
pnpm recall "<質問>"

# 画面のスクリーンショット撮影（AI の自己確認用）
pnpm --filter @repo/verify screenshot

# ハーネスの公開シナリオによる自己テスト
pnpm harness:selftest

# 作業ブランチの取り込み（rebase → ゲート → PR → CI → マージ）
pnpm land

# 新規プロジェクトへの自律開発基盤の展開
pnpm bootstrap <対象ディレクトリ> --name <プロジェクト名> --title <製品名>

# lint・整形・型チェック・テスト
pnpm lint
pnpm format
pnpm typecheck
pnpm test
\`\`\`

## ディレクトリ構成

- \`AGENTS.md\`（\`CLAUDE.md\` は \`@AGENTS.md\` で読み込むだけ）: エージェント向けの開発手引き（Codex / Gemini / Claude Code 共通）
- \`.mcp.json\` / \`.claude/\` / \`.codex/\`: 各エージェント向けの MCP サーバ（\`devboard\`）とフックの設定
- \`apps/\`: アプリケーション本体
- \`packages/\`: 共有パッケージ
- \`tools/harness/\`: ゲート検査・評価ハーネス・\`pnpm land\`・Stop フック・\`pnpm bootstrap\`（\`@repo/harness\`）
- \`tools/verify/\`: ヘッドレス Chrome（DevTools Protocol）による画面確認ツール（\`@repo/verify\`）
- \`docs/\`: プロダクト仕様・アーキテクチャ・検証手順・ハーネス・決定記録（\`docs/decisions/\`）
`;
}

export function renderProductDoc(name: string, title: string): string {
  return `# ${title} プロダクト仕様

## 概要

**${title}**（プロジェクト名 \`${name}\`）のプロダクト仕様書。
開発を進めながら、目的・対象ユーザー・主要機能・マイルストーンをここに追記していく。

## 開発の進め方

- タスク・マイルストーン・教訓は SQLite の開発ボード（\`~/.devboard/boards/${name}.sqlite\`、決定記録 0011）で管理し、Web ダッシュボード（\`pnpm board\`、決定記録 0001、決定記録 0038）で閲覧する
- 画面の確認はヘッドレス Chrome を用いたスクリーンショット撮影（\`pnpm --filter @repo/verify screenshot\`、決定記録 0008）で行う
- コードの品質と規約はゲート（\`pnpm check\`、決定記録 0009、決定記録 0013）と PR・CI（決定記録 0015）で守る

## マイルストーン

- **M0: 開発基盤の整備** — 開発ボード（\`devboard\`）・ハーネス（\`pnpm check\` / \`pnpm harness:selftest\`）・画面確認ツール（\`@repo/verify\`）のセットアップ

## 未決事項

（プロダクトの要件やユーザー体験に関する未決事項が出たらここに追記し、選択肢とトレードオフを揃えてユーザーに確認する）
`;
}

export function renderArchitectureDoc(name: string, title: string): string {
  return `# アーキテクチャ

${title}（\`${name}\`）のリポジトリ構成と、AI 自律駆動を支える開発基盤のアーキテクチャ。

## モノレポ構成

\`pnpm-workspace.yaml\` で管理する pnpm モノレポ（決定記録 0001、決定記録 0039）。

\`\`\`text
${name}/
  AGENTS.md             # エージェント共通の手引き（実体）
  CLAUDE.md             # AGENTS.md を読み込むだけ（@AGENTS.md）
  apps/                 # アプリケーション本体を置く場所
  packages/             # 共有パッケージを置く場所
  spikes/               # 使い捨ての技術検証コードを置く場所
  tools/
    harness/            # ゲート (pnpm check)・評価ハーネス・取り込み (pnpm land)・Stop フック・bootstrap (@repo/harness)
    verify/             # ヘッドレス Chrome による画面確認・待機ツール (@repo/verify)
  docs/
    product.md          # プロダクト仕様・マイルストーン・未決事項
    architecture.md     # このファイル
    verification.md     # AI の自己確認手順
    harness.md          # ハーネスの仕組みと改善手順
    decisions/          # 設計判断の記録 (ADR: NNNN-slug.md)
\`\`\`

## 開発ボードと MCP / CLI (\`devboard\` コマンド)

開発ボードの道具は、全プロジェクトで共有する \`devboard\` コマンド（\`~/github/devboard\`）で、このリポジトリには入っていない。入れ方はそのリポジトリの README の「入れる」。\`pnpm board*\` と \`pnpm recall\` はそのコマンドを呼ぶ。

- **保存先**: git の外の SQLite（既定は \`~/.devboard/boards/${name}.sqlite\`、\`DEVBOARD_DB\` で変更可。決定記録 0011）。変更はすべてイベント表に追記し、同じトランザクションで現在状態の表を更新する
- **MCP サーバ (\`devboard mcp\`)**: \`.mcp.json\` および \`.codex/config.toml\` で登録する。\`get_overview\`、\`list_tasks\`、\`get_task\`、\`create_task\`、\`update_task\`、\`set_milestone\`、\`list_decisions\`、\`get_decision\`、\`create_decision\`、\`set_decision_status\`、\`open_dashboard\`、\`recall\`、\`add_lesson\` を提供する
- **CLI (\`pnpm board:show\` / \`pnpm board:apply\` / \`pnpm recall\`)**: それぞれ \`devboard show\`・\`devboard apply\`・\`devboard recall\`。MCP を使わないエージェントやシェルからも同じ読み書き・検索ができる（決定記録 0039）
- **Web ダッシュボード**: \`devboard start\`（\`pnpm board\` / \`pnpm board:open\` / \`pnpm board:tailscale\`）。\`127.0.0.1\` で待ち受け、タスク一覧・詳細と活動グラフ（\`/activity\`、決定記録 0017）を読み取り専用で表示する（決定記録 0038）

## ゲートと評価ハーネス (\`tools/harness\`)

- **ゲート (\`pnpm check\`)**: \`tools/harness/src/check.ts\`（決定記録 0009、決定記録 0013）
  1. \`gate\`: テストの削除・\`skip\`・空テスト・\`tsconfig.json\` や \`.oxlintrc.json\` の緩め・\`@ts-ignore\` を検出
  2. \`conventions\`: JSDoc の \`any\`、\`127.0.0.1\` 以外での \`listen\`、\`npm\` / \`npx\` の使用を検出
  3. \`records\`: \`docs/decisions/NNNN-slug.md\` の形式と番号の重複を検査
  4. \`docs\`: ドキュメント内のスクリプト名・ファイルパス・決定記録番号・MCP ツール名のリンク切れを検査
  5. \`pnpm lint\`（\`oxlint\`）、\`pnpm typecheck\`、\`pnpm test\` を順に実行
- **Stop フック (\`tools/harness/src/stop-hook.ts\`)**: \`.claude/settings.json\` および \`.codex/hooks.json\` から呼ばれ、ユーザーへの確認の丸投げを差し戻す
- **取り込み (\`pnpm land\`)**: \`tools/harness/src/land.ts\`（決定記録 0010、決定記録 0015）。ロックを取り、\`origin/main\` へ rebase して \`pnpm check\` を通し、PR 作成と CI 通過後に rebase マージする
- **基盤の展開 (\`pnpm bootstrap\`)**: \`tools/harness/src/bootstrap.ts\`（決定記録 0039）。新しいディレクトリに自律開発基盤一式を複製して初期化する

## 画面確認ツール (\`tools/verify\`)

- \`tools/verify/src/screenshot.ts\`（\`pnpm --filter @repo/verify screenshot\`）: DevTools Protocol でヘッドレス Chrome を動かし、要素の出現待ち・クリックや入力の操作・ダークモードやモバイル幅でのスクリーンショット撮影・\`console.error\` の検出を行う（決定記録 0008）
- \`tools/verify/src/windows.swift\`（\`pnpm --filter @repo/verify windows\`）: macOS のウィンドウ一覧を JSON で取得する
`;
}

export function renderVerificationDoc(): string {
  return `# 動かして確かめる

AI がアプリを動かし、結果を自分で確かめるための手段と準備。AGENTS.md の「判断と確認は AI が行う」を支える（決定記録 0008）。

## 使える手段

| 確かめたいこと | 手段 | OS の許可 |
|---|---|---|
| ロジック | \`pnpm test\`、\`pnpm typecheck\` | 要らない |
| コミットしてよいか | \`pnpm check\`（\`docs/harness.md\`） | 要らない |
| Web の画面 | \`pnpm --filter @repo/verify screenshot <url> <出力先.png> --wait-for <CSS セレクタ>\` | 要らない |
| ネイティブのウィンドウが出たか | \`pnpm --filter @repo/verify windows [--all] [持ち主の名前]\` | 要らない |
| ネイティブのウィンドウの中身 | \`screencapture -x -l <ウィンドウ ID> <出力先.png>\` | 画面収録 |
| メモリ・プロセス | \`footprint -p <pid>\`、\`ps -o pid,rss,command -p <pid>\` | 要らない |

- **Web の画面（\`tools/verify/src/screenshot.ts\`）**: ヘッドレスの Chrome を DevTools Protocol で動かし、\`--wait-for\` の要素が出るまで待ってから撮る。モーダルなど操作のあとの画面は、\`--click <CSS セレクタ>\` で開き、入力欄は \`--fill '<CSS セレクタ>=<値>'\` で埋める（最後の \`=\` で分けるので、値に \`=\` は使えない）。\`--click\` と \`--fill\` は、コマンドラインに並べた順に 1 つずつ、要素が出るのを待ってから行うので、クリックの後に出る入力欄も埋められる。操作の後に出る要素は \`--wait-after <CSS セレクタ>\` で待つ。撮るまでに出た \`console.error\` と例外を \`problems\` に返すので、画面とあわせて確かめる。Chrome の場所は \`VERIFY_CHROME\` で変えられる
- **スマホの画面**: 上の Web の画面の撮影に \`--mobile\` を付ける。幅と高さを省くと 390×844 になり、別の機種の大きさは \`--width\` と \`--height\` で変える。2 倍の解像度で撮る（画像は 780px 幅）
- **ライトとダーク**: 上の Web の画面の撮影は、既定でライト（\`prefers-color-scheme: light\`）で描く。\`--dark\` を付けるとダークで描く（\`--mobile\` と合わせられる）
- **動き**: 上の Web の画面の撮影に \`--later <ミリ秒>\` を付けると、撮ったあとその時間だけ待って、同じページをもう 1 枚撮る（\`<出力先>-later.png\`）。\`--reduced-motion\` を付けると \`prefers-reduced-motion: reduce\` で描く
- **言語**: 上の Web の画面の撮影に \`--lang <言語タグ>\`（\`ja\`、\`en-US\` など）を付けると、\`navigator.languages\` と \`Intl\` の既定をその言語にして描く
- **ウィンドウの一覧（\`tools/verify/src/windows.swift\`）**: 画面に出ているウィンドウを JSON で出す（持ち主、pid、ID、位置と大きさ）。画面収録の許可がなくても、ウィンドウが出たかと大きさは分かる。題名は許可があるときだけ入る。\`screenCaptureAllowed\` で許可の有無も分かる。ステージマネージャの別のステージや最小化で画面に出ていないウィンドウは、\`--all\` で含める（\`onScreen\` が false になる）
- **ネイティブのウィンドウの中身**: ウィンドウそのものを撮るときだけ使う。許可がないと、壁紙とメニューバーしか写らない（エラーにはならないので、\`screenCaptureAllowed\` を先に見る）
- 撮った画像は \`.dev/verify/\` に置く（git 管理外）。確かめたら消す

## done にするときに残すもの

テストと型チェックは、コードと同じ思い込みで書いたものを確かめるだけなので、通っても実際に動くとは限らない。振る舞いや画面を変えたタスク（\`paths\` に \`docs/\` と \`.md\` 以外があるもの）は、上の手段で実際に動かし、\`done\` のメモに次の行を入れる。無ければ store が断る。

\`\`\`text
動かした: \`<実際に実行したコマンド>\` → <結果。出力の要点、撮った画像の場所など>
\`\`\`

- コマンドはインラインコードで書く。\`pnpm test\`・\`pnpm typecheck\`・\`pnpm lint\`・\`pnpm check\`・ビルドだけの行は、証拠に数えない
- 1 つのメモに何行あってもよく、前のメモに書いた行でもよい
- 何を動かすかの目安: 画面は Web の画面の撮影、ネイティブのウィンドウはウィンドウの一覧、CLI やサーバは起動して出力や応答を見る、ボードの決まりは \`DEVBOARD_DB\` で写しを指して \`pnpm board:apply\`、ハーネスは \`pnpm harness:selftest\`
- docs だけのタスクと、\`paths\` の無いタスクは対象外。\`paths\` は着手の前に書く（並行の判断にも使う）

## ユーザーに一度だけしてもらう準備

AI は自分の権限の設定を書き換えられない（Claude Code の auto モードが「自己改変」として止める）。次の 2 つはユーザーが行う。

### Claude Code の許可（\`.claude/settings.local.json\`）

\`\`\`sh
cp tools/verify/settings.local.example.json .claude/settings.local.json
\`\`\`

- 許可するのは、workspace のスクリプト（\`pnpm --filter @repo/* ...\`）と \`screencapture\`
- \`autoMode.environment\` で、このリポジトリのツールチェーンを信頼してよいことを安全判定に伝える
- \`.claude/settings.local.json\` は git 管理外で、この Mac だけに効く。すでにあるときは、雛形の中身を手で混ぜる

### 画面収録の許可（ネイティブのウィンドウを撮るときだけ）

システム設定 → プライバシーとセキュリティ → 画面とシステムオーディオ録音 で、Claude Code を動かしているアプリを許可する。許可したらそのアプリを起動し直す。

- 許可がなくても、Web の画面はヘッドレスの Chrome で撮れるので、多くの確認はこれで足りる
`;
}

export function writeBootstrapFiles(opts: BootstrapOptions): void {
  const { targetDir, name, title } = opts;
  const sourceRoot = opts.sourceRoot ?? DEFAULT_SOURCE_ROOT;
  if (existsSync(join(targetDir, "package.json"))) {
    throw new Error(`${targetDir} にはすでに package.json がある。空のディレクトリを指定する`);
  }
  mkdirSync(targetDir, { recursive: true });

  for (const rel of ROOT_FILES) {
    const src = join(sourceRoot, rel);
    if (!existsSync(src)) continue;
    const dst = join(targetDir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
  writeFileSync(
    join(targetDir, "pnpm-workspace.yaml"),
    'packages:\n  - "apps/*"\n  - "packages/*"\n  - "tools/*"\n  - "spikes/*"\n',
  );

  copyTreeFiltered(join(sourceRoot, ".githooks"), join(targetDir, ".githooks"));
  copyTreeFiltered(join(sourceRoot, "tools/harness"), join(targetDir, "tools/harness"), skipHeldout);
  for (const rel of VERIFY_FILES) {
    const src = join(sourceRoot, "tools/verify", rel);
    if (!existsSync(src)) continue;
    const dst = join(targetDir, "tools/verify", rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
  const verifyPkg = JSON.parse(readFileSync(join(sourceRoot, "tools/verify/package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  writeFileSync(
    join(targetDir, "tools/verify/package.json"),
    `${JSON.stringify(
      {
        name: "@repo/verify",
        private: true,
        type: "module",
        scripts: {
          screenshot: "node src/screenshot.ts",
          windows: "swift src/windows.swift",
          typecheck: "tsc --noEmit",
          test: "node --test test/*.test.ts",
        },
        dependencies: verifyPkg.dependencies,
        devDependencies: verifyPkg.devDependencies,
      },
      null,
      2,
    )}\n`,
  );

  mkdirSync(join(targetDir, "docs/decisions"), { recursive: true });
  for (const decision of ENV_DECISIONS) {
    const src = join(sourceRoot, "docs/decisions", decision);
    if (existsSync(src)) cpSync(src, join(targetDir, "docs/decisions", decision));
  }
  const decision39Src = existsSync(join(sourceRoot, "docs/decisions/0040-multi-agent-and-bootstrap.md"))
    ? join(sourceRoot, "docs/decisions/0040-multi-agent-and-bootstrap.md")
    : join(sourceRoot, "docs/decisions/0039-multi-agent-and-bootstrap.md");
  if (existsSync(decision39Src)) {
    const content = readFileSync(decision39Src, "utf8").replace(/^# 0040\./, "# 0039.");
    writeFileSync(join(targetDir, "docs/decisions/0039-multi-agent-and-bootstrap.md"), content);
  }

  for (const dir of ["apps", "packages", "spikes", "tools/harness/eval/heldout"]) {
    mkdirSync(join(targetDir, dir), { recursive: true });
    writeFileSync(join(targetDir, dir, ".gitkeep"), "");
  }
  mkdirSync(join(targetDir, "dev/harness"), { recursive: true });
  writeFileSync(join(targetDir, "dev/harness/history.jsonl"), "");

  writeFileSync(join(targetDir, "package.json"), renderPackageJson(name, title, sourceRoot));
  writeFileSync(
    join(targetDir, "AGENTS.md"),
    renderAgentGuide(name, title, readFileSync(join(sourceRoot, "tools/harness/rules/common.md"), "utf8")),
  );
  writeFileSync(join(targetDir, "CLAUDE.md"), "@AGENTS.md\n");
  writeFileSync(join(targetDir, "README.md"), renderReadme(name, title));
  writeFileSync(join(targetDir, "docs/product.md"), renderProductDoc(name, title));
  writeFileSync(join(targetDir, "docs/architecture.md"), renderArchitectureDoc(name, title));
  writeFileSync(join(targetDir, "docs/verification.md"), renderVerificationDoc());
}

// 展開元（init-autodev スキルの base/ など）を作る。writeBootstrapFiles が展開元から読むファイルだけを写す。
// 古い展開元を上書きして古いファイルを残さないよう、出力先は空のディレクトリに限る
export function exportBase(sourceRoot: string, destDir: string): void {
  if (existsSync(destDir) && readdirSync(destDir).length) {
    throw new Error(`${destDir} は空ではない。空のディレクトリを指定する（古い展開元は先に ~/.Trash などへ移す）`);
  }
  mkdirSync(destDir, { recursive: true });
  const files = [
    ...ROOT_FILES,
    "package.json",
    ...VERIFY_FILES.map((rel) => `tools/verify/${rel}`),
    "tools/verify/package.json",
    ...ENV_DECISIONS.map((decision) => `docs/decisions/${decision}`),
    "docs/decisions/0040-multi-agent-and-bootstrap.md",
    "docs/decisions/0039-multi-agent-and-bootstrap.md",
  ];
  for (const rel of files) {
    const src = join(sourceRoot, rel);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(join(destDir, rel)), { recursive: true });
    cpSync(src, join(destDir, rel));
  }
  copyTreeFiltered(join(sourceRoot, ".githooks"), join(destDir, ".githooks"));
  copyTreeFiltered(join(sourceRoot, "tools/harness"), join(destDir, "tools/harness"), skipHeldout);
}

export function bootstrapProject(opts: BootstrapOptions): void {
  writeBootstrapFiles(opts);
  if (opts.filesOnly) return;

  const cwd = realpathSync(opts.targetDir);
  const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
    execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

  if (!existsSync(join(cwd, ".git"))) {
    run("git", ["init", "-b", "main"]);
  }
  run("pnpm", ["install"]);

  // devboard コマンドで、ボードの表示名・マイルストーン・最初のタスクを入れる
  const initOps = [
    { op: "set_project", args: { name: opts.title, summary: opts.summary } },
    {
      op: "set_milestone",
      args: {
        id: "M0",
        title: "開発基盤の整備",
        goal: "AI 自律駆動の仕組み（開発ボード・MCP / CLI・ハーネス・画面確認ツール）を整える",
        status: "done",
      },
    },
    {
      op: "create_task",
      args: {
        title: "開発基盤とダッシュボード環境を整備する",
        description: "自律開発基盤とダッシュボードのツールを展開し、新規プロジェクトを進められる準備を行う。",
        priority: "high",
        milestone: "M0",
        paths: ["tools/", "docs/", ".githooks/", ".github/"],
      },
    },
    // "$2" は、3 番目の操作（上の create_task）が作ったタスクの ID
    {
      op: "update_task",
      args: {
        id: "$2",
        status: "done",
        note: "動かした: `pnpm bootstrap` → 開発基盤の展開・pnpm check・初期コミットが完了",
      },
    },
  ];
  run("devboard", ["apply", JSON.stringify(initOps)]);

  const filesToStage = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  run("git", ["add", "--", ...filesToStage]);
  run("git", ["commit", "-m", "chore: initialize autonomous development environment", "-m", "Task: T-001"], {
    HARNESS_SKIP_REVIEW: "1",
  });
}

// --export-base <出力先> [--source <展開元>]
function exportBaseFromArgs(argv: string[]): string {
  const dest = argv[argv.indexOf("--export-base") + 1];
  if (!dest || dest.startsWith("-")) throw new Error(`--export-base の値が無い\n${USAGE}`);
  const sourceIndex = argv.indexOf("--source");
  const base = process.env.INIT_CWD ?? process.cwd();
  const source =
    sourceIndex >= 0 && argv[sourceIndex + 1] ? resolve(base, argv[sourceIndex + 1]!) : DEFAULT_SOURCE_ROOT;
  const out = resolve(base, dest);
  exportBase(source, out);
  return `bootstrap: 展開元 ${source} の基盤を ${out} に書き出した`;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes("--export-base")) {
      console.log(exportBaseFromArgs(argv));
    } else {
      const opts = parseBootstrapArgs(argv);
      bootstrapProject(opts);
      console.log(`bootstrap: ${opts.title} (${opts.name}) を ${opts.targetDir} に用意した`);
    }
  } catch (e) {
    console.error(`bootstrap: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
