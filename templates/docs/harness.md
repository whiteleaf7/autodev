# ハーネス

AI が自律して開発を回すための仕組み（ゲート、フック、取り込み、評価）は、全プロジェクトで共有する `autodev` コマンドが持つ。仕組みの説明は、autodev のリポジトリの `docs/harness.md`（`~/github/autodev/docs/harness.md`。公開は `https://github.com/whiteleaf7/autodev`）にある。ここには、このプロジェクトとの接点だけを書く。

## このプロジェクトの呼び出し口

- `package.json` のスクリプトが `autodev` を呼ぶ: `pnpm check`（`autodev check`）、`pnpm land`（`autodev land`）、`pnpm worktree:prune`（`autodev prune`）、`pnpm harness:selftest`・`pnpm harness:eval`（`autodev eval`）、`pnpm harness:mutate`（`autodev mutate`）
- `.githooks/` のフックは、`autodev hook <名前>` を呼ぶ（`git config core.hooksPath .githooks`。`pnpm install` でも設定される）
- `.claude/settings.json` と `.codex/hooks.json` のフックは、`autodev roborev-doctor` と `autodev stop-hook` を呼ぶ
- CI（`.github/workflows/check.yml`）は、devboard と autodev を GitHub から取って入れてから、`pnpm check` を回す

## このプロジェクトのデータ

- `.autodev/eval/public/`: 評価の公開のシナリオ。改善の作業中に見てよい。ゲートの自己テストにもなる
- `.autodev/eval/heldout/`: 最終評価用のシナリオを置く場所（いまは空）。置いたら、**改善する側は中身を読まない**。ランナーも集計しか出さない。`.devboard.json` の `hiddenPaths` が、このパスを触ったタスクの本文を `recall` で返さないようにしている
- `.autodev/history.jsonl`: 評価の点数の推移（`pnpm harness:eval --set heldout --record` で足される）

## 直すとき

- ハーネス（ゲート、フック、評価のランナー）を直すときは、`~/github/autodev` で直す。直すと、autodev を使うすべてのプロジェクトに、同時に効く
- 評価のシナリオ（このプロジェクトのデータ）を足す・直すときは、`.autodev/eval/public/` に足し、`pnpm harness:selftest` で確かめる
- AGENTS.md の共通の規約の区画は、`autodev rules-sync` が作る。区画は直接直さない
