# autodev

AI 自律開発の実行基盤。コミット前のゲート（`autodev check`）、git のフック、PR での取り込み（`autodev land`）、ハーネスの評価（`autodev eval`）、Chrome を操作する検証ツールを、`autodev` コマンド 1 つにまとめたもの。複数のプロジェクトが、このリポジトリを 1 つだけ共有して使う。開発ボードは別のリポジトリ（devboard）にある。主な読み手は AI エージェント。

## 導入する（AI 向けの手順）

上から順に実行し、各手順の確認が通ってから次へ進む。

1. 前提を確かめる。`git --version` と `node --version`（24 以上）と `pnpm --version` が通ること。pnpm が無ければ `corepack enable`
2. 入れる
   ```sh
   git clone https://github.com/whiteleaf7/autodev.git ~/github/autodev
   cd ~/github/autodev
   pnpm install
   pnpm run link-bin   # ~/.local/bin/autodev に置く
   ```
3. 確かめる。`autodev --help` がコマンドの一覧を出すこと。`command not found` なら `~/.local/bin` が PATH に無い。シェルの設定に `export PATH="$HOME/.local/bin:$PATH"` を足し、ユーザーにシェルを開き直すよう頼む（絶対パス `~/.local/bin/autodev` なら今すぐ動く）

更新は `cd ~/github/autodev && git pull && pnpm install`。このコマンドは、入れたすべてのプロジェクトに同時に効く。

## 使う

プロジェクトのディレクトリ（サブディレクトリや linked worktree でもよい）で打つ。対象は、そのディレクトリの git の作業ツリー。

| コマンド                 | することと                                                                 |
| ------------------------ | -------------------------------------------------------------------------- |
| `autodev init <ディレクトリ>` | 新しいプロジェクトに、設定と文書の雛形を書いて、初期化する（`--name`・`--title`・`--summary`・`--files-only`） |
| `autodev check`          | ゲート。評価の緩め・規約・記録・ドキュメント・共通の規約の検査のあと、lint・型チェック・テスト。`--staged` で index を検査する。`--base <rev>` で、取り込み先のブランチとも比べる（land が使う）。同じ中身を通した記録があれば、lint・型チェック・テストは飛ばす（`--no-cache` で必ず回す） |
| `autodev gate-log`       | 速い検査の記録。observe の検査が止めずに記録したものと、enforce の検査が止めたものの、検査ごとの件数と例（`--check <名前>` で 1 つの検査のすべての指摘） |
| `autodev hook <名前>`    | git のフックの本体（`pre-commit`・`commit-msg`・`pre-push`）               |
| `autodev land`           | 作業ブランチを、rebase → ゲート → PR → CI → マージで main に取り込む        |
| `autodev prune`          | 取り込み済みの作業用 worktree を片付ける                                   |
| `autodev eval`           | ハーネスの評価（`--set public` か `heldout`、`--family`、`--validate`、`--record`） |
| `autodev mutate`         | 変異テスト                                                                 |
| `autodev rules-sync`     | AGENTS.md の共通の規約の区画を、autodev の最新の共通の規約で作り直す（`harness/rules/common.md`が正本） |
| `autodev stop-hook`      | エージェントの Stop フックの本体                                           |
| `autodev roborev-doctor` | roborev の状態を調べる                                                     |
| `autodev screenshot`     | ヘッドレス Chrome で Web の画面を撮る                                      |
| `autodev windows`        | macOS のウィンドウの一覧を出す（ネイティブのアプリの確認用）               |

## プロジェクトに置くもの

autodev を使うプロジェクトには、実行基盤のコードは置かない。置くのは、`autodev` を呼ぶ設定と、プロジェクトのデータだけ。

- `package.json` のスクリプト: `"check": "autodev check"`、`"land": "autodev land"`、`"worktree:prune": "autodev prune"`、`"harness:eval": "autodev eval"`、`"harness:selftest": "autodev eval --set public"`、`"harness:mutate": "autodev mutate"`
- `.githooks/`: このリポジトリの `githooks/` の写し（`autodev hook <名前>` を呼ぶだけ。`git config core.hooksPath .githooks` で有効にする）
- `.claude/settings.json`・`.codex/hooks.json` のフック: `autodev stop-hook`、`autodev roborev-doctor`
- `.autodev/eval/public/`・`.autodev/eval/heldout/`: 評価のシナリオ（形式は `harness/eval/SPEC.md`）。heldout は最終評価用で、改善する側は中身を読まない。`.autodev/history.jsonl` は、点数の推移
- `AGENTS.md` の共通の規約の区画: `autodev rules-sync` が作る。区画の外が、プロジェクト固有の記述
- CI: autodev を取って入れてから、`autodev check` を回す（`.github/workflows/check.yml` で、このリポジトリを `git clone` して、`pnpm install` と `pnpm run link-bin`）

## verify を、ほかのプロジェクトのテストから使う

Chrome を操作する補助ライブラリ（`verify/src/chrome.ts` の `withChrome`、`verify/src/screenshot.ts` の `capture` など）は、git 依存として、ほかのプロジェクトのテストから使える。

```json
{
  "devDependencies": {
    "autodev": "github:whiteleaf7/autodev"
  },
  "scripts": {
    "test": "node --import autodev/verify/register.js --test test/*.test.ts"
  }
}
```

```ts
import { withChrome } from "autodev/verify/src/chrome.ts";
```

- git 依存は `node_modules` の中に入り、Node は `node_modules` の中の `.ts` の型を剥がして実行しない（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。`verify/register.js` を `--import` で読むと、`autodev/verify/` の `.ts` だけは読めるようになる
- `verify/` だけを `#path:/verify` で取り込む書き方は使わない。pnpm が、新しいストアでの `--frozen-lockfile` の取得で path を無視し、リポジトリの全体を取り込んでしまう（CI で import が解決できず落ちる）。リポジトリのルート（`autodev`）を依存にして、`autodev/verify/…` で import する
- 版は、ロックファイルが固定する（コミット）。更新は `pnpm update autodev`。コマンド（`autodev check` など）と違い、ライブラリは、更新するまで固定の版が使われる

## 構成

- `harness/`: ゲート・フック・取り込み・評価の本体（`@autodev/harness`）。テストもここにある
- `verify/`: Chrome を DevTools Protocol で操作する検証ツール（`@autodev/verify`）。画面の撮影と、Web の画面のテストの補助。ほかのプロジェクトのテストが、パッケージとして取り込める
- `githooks/`: プロジェクトの `.githooks/` に置くフックの雛形（`autodev hook` を呼ぶだけ）
- `bin/autodev.ts`、`src/commands.ts`: サブコマンドの入口

## 開発する

```sh
pnpm typecheck
pnpm test
pnpm lint
```

型検査は `bun check` を使うので、`bun` が要る（`--no-script` は、パッケージに `check` スクリプトがあるときに、型検査の代わりにそれを動かしてしまうのを避ける）。`pnpm install` で `.githooks/pre-commit` が有効になり、コミットの前に lint・型・テストを同時に流す。

このコマンドは全プロジェクトで同時に使われる。変更は、テストを足してから入れる。評価のシナリオ（公開・heldout）と設定は、各プロジェクトのデータなので、このリポジトリには入れない（heldout は特に、公開しない）。
