# アーキテクチャ

{{title}}（`{{name}}`）のリポジトリ構成と、AI 自律駆動を支える開発基盤のアーキテクチャ。

## モノレポ構成

`pnpm-workspace.yaml` で管理する pnpm モノレポ。

```text
{{name}}/
  AGENTS.md             # エージェント共通の手引き（実体）
  CLAUDE.md             # AGENTS.md を読み込むだけ（@AGENTS.md）
  apps/                 # アプリケーション本体を置く場所
  packages/             # 共有パッケージを置く場所
  spikes/               # 使い捨ての技術検証コードを置く場所
  .autodev/             # 評価のシナリオと点数の推移（実行基盤の本体は、共有の autodev コマンド）
  docs/
    product.md          # プロダクト仕様・マイルストーン・未決事項
    architecture.md     # このファイル
    verification.md     # AI の自己確認手順
    harness.md          # ハーネスの仕組みと改善手順
    decisions/          # 設計判断の記録 (ADR: NNNN-slug.md)
```

## 開発ボードと MCP / CLI (`devboard` コマンド)

開発ボードの道具は、全プロジェクトで共有する `devboard` コマンド（`~/github/devboard`）で、このリポジトリには入っていない。入れ方はそのリポジトリの README の「入れる」。`pnpm board*` と `pnpm recall` はそのコマンドを呼ぶ。

- **保存先**: git の外の SQLite（既定は `~/.devboard/boards/{{name}}.sqlite`、`DEVBOARD_DB` で変更可）。変更はすべてイベント表に追記し、同じトランザクションで現在状態の表を更新する
- **設定**: プロジェクトの根の `.devboard.json`（recall が中身を隠すパス、動かした結果の書き方の案内など）。devboard はプロジェクトの名前や場所を持たず、ここで受け取る
- **MCP サーバ (`devboard mcp`)**: `.mcp.json` および `.codex/config.toml` で登録する。`get_overview`、`list_tasks`、`get_task`、`create_task`、`update_task`、`set_milestone`、`list_decisions`、`get_decision`、`create_decision`、`set_decision_status`、`open_dashboard`、`recall`、`add_lesson`、`update_lesson` を提供する
- **CLI (`pnpm board:show` / `pnpm board:apply` / `pnpm recall`)**: それぞれ `devboard show`・`devboard apply`・`devboard recall`。MCP を使わないエージェントやシェルからも同じ読み書き・検索ができる
- **Web ダッシュボード**: `devboard start`（`pnpm board` / `pnpm board:open` / `pnpm board:tailscale`）。`127.0.0.1` で待ち受け、タスク一覧・詳細と活動グラフ（`/activity`）を読み取り専用で表示する

## 実行基盤（`autodev` コマンド）

ゲート・フック・取り込み・評価・画面確認は、全プロジェクトで共有する別リポジトリ（`~/github/autodev`。公開は `https://github.com/whiteleaf7/autodev`）の `autodev` コマンドが持つ。仕組みの説明は、そのリポジトリの README と `docs/harness.md` にある。ここには、このプロジェクトとの接点だけを書く。

- **ゲート (`pnpm check`)**: `autodev check`。評価の緩め・規約・決定記録・ドキュメント・共通の規約の検査のあと、`pnpm lint`・`pnpm typecheck`・`pnpm test`
- **フック**: `.githooks/` が `autodev hook <名前>` を、`.claude/settings.json` と `.codex/hooks.json` が `autodev stop-hook` を呼ぶ
- **取り込み (`pnpm land`)**: `autodev land`。`origin/main` へ rebase して `pnpm check` を通し、PR 作成と CI 通過後に rebase マージする
- **評価 (`pnpm harness:selftest`)**: `autodev eval`。シナリオは `.autodev/eval/public/`、点数の推移は `.autodev/history.jsonl`
- **画面確認**: `autodev screenshot`（ヘッドレス Chrome で画面を撮る）、`autodev windows`（macOS のウィンドウ一覧を JSON で取る）
- **CI**: `.github/workflows/check.yml` が、devboard と autodev を取って入れてから `pnpm check` を回す

