# {{title}} ({{name}})

**{{title}}**（リポジトリ名 `{{name}}`）。AI エージェント（Claude Code、Codex、Gemini など）が自律して開発を進めるための基盤（開発ボード・MCP / CLI・ハーネス・画面確認ツール）を備えたプロジェクト。
エージェント向けの手引きは `AGENTS.md` に置いてある。`CLAUDE.md` は `@AGENTS.md` と書くだけで、同じ内容を読み込む。

## まず読む

- 作業を始めるときは、MCP `devboard` の `get_overview`（MCP が無い環境では `pnpm board:show overview`）で現在のマイルストーンと進行中のタスクを確認する
- `docs/product.md`: 何を作るか、未決事項
- `docs/architecture.md`: 構成とリポジトリの配置
- `docs/decisions/`: 決定記録。設計に関わる作業の前に、関係するものを読む
- `docs/verification.md`: 動かして確かめる手段（画面の撮影、ウィンドウの一覧）と、ユーザーに一度だけしてもらう準備
- `docs/harness.md`: コミット前のゲート、フック、worktree の取り込み、記録の検索、ハーネスの評価のしかた

{{region}}

## コマンド

- 型チェック: `pnpm typecheck`
- 整形: `pnpm format`（コミットのときは pre-commit が自動で整形する）
- lint: `pnpm lint`（oxlint。型情報つき）
- テスト: `pnpm test`
- ダッシュボード: `pnpm board`（前面）/ `pnpm board:open`（裏で起動してブラウザで開く）
- ボードの読み書き（CLI）: `pnpm board:show`（overview・tasks・task・decisions・decision）/ `pnpm board:apply '<JSON>'`
- ゲート: `pnpm check`（評価の緩め・規約・記録・ドキュメントの検査のあと、lint・型チェック・テスト。`docs/harness.md`）
- 記録を探す: `pnpm recall "<質問>"`
- ボードを git の履歴から再現する: `pnpm board:import`（空のボードにだけ入れる。置き場所は `DEVBOARD_DB` で変えられる）
- ブランチを PR で main に取り込む: `pnpm land`（main 以外のブランチの上で）/ 片付け: `pnpm worktree:prune`
- ハーネスの評価: `pnpm harness:selftest`（公開用のシナリオ）/ `pnpm harness:eval --set heldout --record`（最終評価用。集計だけを見る）
- 実行基盤（ゲート・フック・取り込み・評価）は、全プロジェクトで共有する `autodev` コマンド（`~/github/autodev`。公開は `https://github.com/whiteleaf7/autodev`）で、このリポジトリには入っていない。`pnpm check`・`pnpm land`・`pnpm harness:*` はそれを呼ぶ。直すときは `~/github/autodev` で直す。入れ方は autodev の README の「導入する」
- 新規プロジェクトへの基盤展開: `init-autodev` スキル（`~/.agents/skills/init-autodev/`）
- 共通の規約（上の区画）の更新: `autodev rules-sync`（区画の外の固有の記述は変わらない。区画は直接直さない）
