# {{title}} (`{{name}}`)

**{{title}}**（リポジトリ名 `{{name}}`）は、AI エージェント（Claude Code、Codex、Gemini など）が自律して開発を進めるための仕組み（開発ボード・MCP / CLI・ハーネス・自動検証）を備えたプロジェクトです。

## 必要環境

- macOS
- Node.js `>= 24`（`.node-version` 参照）
- `pnpm`（`corepack enable` で `package.json` の `packageManager` を使用）

## セットアップ

```sh
pnpm install
```

`pnpm install` の `prepare` スクリプトにより、`.githooks` が Git フックとして設定されます。

## 開発コマンド

```sh
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
autodev screenshot

# ハーネスの公開シナリオによる自己テスト
pnpm harness:selftest

# 作業ブランチの取り込み（rebase → ゲート → PR → CI → マージ）
pnpm land

# 新規プロジェクトへの自律開発基盤の展開は、init-autodev スキル（~/.agents/skills/init-autodev/）から行う

# lint・整形・型チェック・テスト
pnpm lint
pnpm format
pnpm typecheck
pnpm test
```

## ディレクトリ構成

- `AGENTS.md`（`CLAUDE.md` は `@AGENTS.md` で読み込むだけ）: エージェント向けの開発手引き（Codex / Gemini / Claude Code 共通）
- `.mcp.json` / `.claude/` / `.codex/`: 各エージェント向けの MCP サーバ（`devboard`）とフックの設定
- `apps/`: アプリケーション本体
- `packages/`: 共有パッケージ
- `.autodev/`: ハーネスの評価のシナリオと点数の推移（実行基盤の本体は、共有の `autodev` コマンド）
- `docs/`: プロダクト仕様・アーキテクチャ・検証手順・ハーネス・決定記録（`docs/decisions/`）
