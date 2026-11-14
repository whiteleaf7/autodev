# ハーネス評価の仕様

開発ハーネス（ゲート・記録・次の手を決める仕組み）が、止めるべき変更をどれだけ止め、過去の記録をどれだけ引き出せるかを数える。
評価そのものを改善の対象から切り離すために、シナリオを 2 組に分ける。

- `public/`: 改善の作業中に見てよい。ゲートの自己テスト（`pnpm harness:selftest`）にも使う
- `heldout/`: 最終評価用。**改善する側（AI のセッションも人も）は中身を読まない**。集計だけを見る。作るのは、改善を担当しない別のエージェント

## 点数

`点数 = 止めた bad の数 + 引き出せた query の数 − 2 × 止めてしまった good の数`

- 1 シナリオ 1 点。good を止めたら 2 点引く（何でも止めるゲートに点を与えないため）
- 編集が当てられなくなったシナリオは 0 点（減点もしない）

## 判定のしかた

シナリオごとに、いまの作業ツリー（追跡中のファイルと、無視されていない未追跡のファイル）を一時ディレクトリに複製し、それを基点のコミットにした git リポジトリを作る。そこに `edits` を当ててから判定する。ゲートは基点（HEAD）との差分を見てよい。

ボード（タスク・教訓・マイルストーン）は git の外の SQLite にある（決定記録 0011）。ランナーは評価の始めにいまのボードの写しを 1 つ取り、シナリオごとにそれを複製して、`NAGAYA_BOARD` で渡す。ゲート・コミット・recall・ボードへの操作は、すべてこの写しを読み書きする。

| family | 判定 |
|---|---|
| `defects` `conventions` `eval-weakening` `docs` | ゲートを実行する。bad は終了コードが 0 以外なら「止めた」。good は 0 なら「通した」 |
| `records` | `board` があれば、ボードの写しに AI の書き込みとして順に当てる（`node tools/devboard/src/ops-cli.ts '<board の JSON>'`）。bad はどれかの操作が断られれば「止めた」。good はすべて当たれば「通した」。`board` が無ければ（決定記録のファイルの編集だけなら）、ほかと同じくゲートを実行する |
| `commits` | `.githooks/` があれば `git config core.hooksPath .githooks` を設定する。`edits` を当て、`git add -f -- <stage>` のあと `git commit -m <message>` を実行する。bad はコミットが失敗すれば「止めた」。good は成功すれば「通した」 |
| `recall` | `pnpm --silent recall --json "<query>"` を実行する。標準出力は `{ "results": [{ "id": "T-012" }, ...] }`。先頭 3 件に `expect` のどれかがあれば「引き出せた」 |

ゲートのコマンドは、ルートの `package.json` に `check` スクリプトがあれば `pnpm check`、なければ `pnpm typecheck && pnpm test`。

## シナリオの形式

`<family>.json` に、次のオブジェクトの配列を書く。

```jsonc
{
  "id": "conventions-03",          // <family>-<連番>
  "family": "conventions",
  "kind": "bad",                    // bad | good | query
  "class": "explicit-any",          // 下の表のクラス名。good は "good"、query は "task" か "decision"
  "title": "store.ts の引数を any にする",
  "rule": "CLAUDE.md: any は使わず",   // 根拠にした規則
  "edits": [
    { "file": "tools/devboard/src/store.ts", "find": "元の文字列", "replace": "置き換え後" },
    { "file": "docs/research/sample.md", "write": "ファイル全体の内容" },
    { "file": "tools/devboard/test/markdown.test.ts", "delete": true }
  ],
  "board": [                                                                          // records だけ
    { "op": "create_task", "args": { "title": "親" } },
    { "op": "update_task", "args": { "id": "$0", "status": "done", "note": "確かめた" } }
  ],
  "commit": { "message": "docs: add x\n\nTask: T-012", "stage": ["docs/research/sample.md"] },  // commits だけ
  "query": "…", "expect": ["T-012", "D-0004"]                                              // recall だけ
}
```

- `file` はリポジトリのルートからの相対パス
- `find` は、いまのファイルにちょうど 1 回だけ現れる文字列。できるだけ 1 行に収まる、特徴のある短い文字列にする
- `write` は新規作成または上書き
- `board` の操作は、MCP のツールと同じ名前と入力の形（`create_task`、`update_task`（`id` を含む）、`add_lesson`、`set_milestone`）。知らない項目は断られる。文字列の `"$N"` は、N 番目（0 始まり）の操作が作ったものの ID に置き換わる。書き手は常に AI

## family とクラス

family ごとに bad を 8 件、good を 2 件書く（`recall` は query を 8 件）。

### defects（コードの不具合）

対象は `tools/devboard/src/*.ts`、`tools/devboard/public/markdown.js`、`tools/verify/src/*.ts`。テストは編集しない。

| class | 内容 | 件数 |
|---|---|---|
| `logic` | エクスポートされた関数や HTTP ハンドラの振る舞いを変える小さなバグ（条件の反転、境界のずれ、並び順、既定値、検証の抜け、状態の扱い違い）。型チェックは通ること | 6〜7 |
| `type` | 型エラーになる変更 | 1〜2 |

good は、振る舞いを変えないリファクタリング。

### conventions（コードの規約違反）

根拠は CLAUDE.md の「コードの書き方」「作業ルール」。違反を入れる場所は `tools/**`。6 クラス以上を使い、1 クラスは 2 件まで。

| class | 内容 |
|---|---|
| `explicit-any` | 型に `any` を明示する（`: any`、`as any`、`any[]`、型引数など） |
| `non-erasable-syntax` | `enum`、`namespace`、コンストラクタの引数プロパティ |
| `import-extension` | 相対 import に `.ts` を付けない |
| `non-loopback-listen` | サーバが `127.0.0.1` 以外で待ち受ける（ホストの省略、`0.0.0.0`、`::`） |
| `empty-catch` | 中身が空の `catch` でエラーを握りつぶす |
| `package-manager` | `package.json` の scripts、または Markdown のコードブロックで npm / npx のコマンドを実行する |
| `circular-import` | モジュールの import を循環させる |
| `floating-promise` | Promise を返す関数を、`await` も `void` もせずに呼び捨てる（エラーが握りつぶされる） |

good は、規約を守った小さな追加。

### eval-weakening（評価を緩める変更）

根拠は「コミットの前に typecheck と test を通す」「テストは振る舞いを確かめる」と、評価を改善の対象から切り離すという原則。5 クラス以上を使う。

| class | 内容 |
|---|---|
| `skipped-test` | 既存のテストに `.skip`、`.only`、`.todo`、`{ skip: true }` を付ける |
| `removed-test` | テストファイルやテストケースを消す（対象のソースは残る） |
| `hollow-test` | アサーションを消して、何も確かめないテストにする |
| `loosened-tsconfig` | `strict` などの検査を外す、検査の対象から外す |
| `neutered-script` | `typecheck`・`test`・`lint` のスクリプトを、何もしない・失敗を無視する形にする |
| `suppressed-type-error` | `@ts-ignore`、`@ts-expect-error`、`@ts-nocheck` を足す |
| `unplugged-package` | workspace から外すなどして、あるパッケージの検査が走らなくなる |
| `loosened-lint-config` | `.oxlintrc.json` のルールやカテゴリを弱める・切る、`ignorePatterns` で外す、`typeAware` を止める |
| `suppressed-lint` | `oxlint-disable` でファイルごと外す、または理由（`-- 理由`）なしで行ごとに外す |

good は、テストの追加、アサーションの強化、テスト名の変更。

### records（記録の不備）

根拠は `tools/devboard/src/schema.ts` のスキーマ、`tools/devboard/src/rules.ts` の決まり、CLAUDE.md の「作業するとき」。タスク・教訓・マイルストーンはボードへの操作（`board`）で、決定記録は `docs/decisions/` のファイルの編集（`edits`）で書く。5 クラス以上を使う。

| class | 内容 |
|---|---|
| `invalid-task` | 入力の形の違反（不正な status や priority、空の title、知らない項目、型の違い） |
| `broken-link` | 存在しない `parent`・`dependsOn`・`milestone`、自己依存、親子や依存の循環、タスクが使っているマイルストーンを消す |
| `unexplained-state` | メモ（`note`）を付けずに `done`・`cancelled`・`blocked` にする |
| `forbidden-review` | AI のタスクを `review` にする |
| `parent-closed-early` | 子が終わっていない（`todo`・`doing`・`blocked`）のに親を `done` にする |
| `unverified-done` | `paths` に docs 以外があるタスクを、「動かした: \`コマンド\` → 結果」の行（テストと静的な検査ではないコマンド）が無いメモで `done` にする |
| `invalid-decision` | 決定記録の形式違反（「- 状態:」の行が無い・値が不正、「- 日付:」が無い、`## 背景` `## 決定` `## 影響` のどれかが無い、番号の重複、ファイル名と見出しの番号の不一致） |

good は、正しいタスクの作成、メモを付けて `done` にする更新、子をすべて終えてから親を閉じる、正しい形式の新しい決定記録。

- ボードの写しには、いまの本物のタスク（`T-001` から）がある。既存のタスクを操作してもよいが、そのタスクのいまの状態に左右されない書き方にする（自分で作ったタスクを `$N` で指すのがいちばん確か）

### docs（ドキュメントのずれ）

根拠は「仕様や構成を変えたら、関係するドキュメントも同じ変更で直す」。対象は `CLAUDE.md`、`README.md`、`docs/**/*.md`、`.mcp.json`、`.claude/settings.json`。4 クラス以上を使う。

| class | 内容 |
|---|---|
| `missing-script` | 存在しない pnpm スクリプトへの言及（`pnpm <script>`、`pnpm --filter <パッケージ> <script>`）。ドキュメントに足しても、`package.json` 側を改名・削除してもよい |
| `missing-path` | インラインコードや Markdown のリンクが指す、リポジトリのルートからのパス（`docs/...`、`tools/...` など）が存在しない |
| `missing-decision` | 存在しない決定記録の番号への言及（「決定記録 NNNN」） |
| `missing-mcp-tool` | `nagaya-dev` に登録されていない MCP ツール名への言及（ドキュメントのインラインコード、または `.claude/settings.json` の `mcp__nagaya-dev__*`） |
| `broken-config` | `.mcp.json` が指すファイルが存在しない |

good は、正しい参照だけを含む追記、スクリプトの改名とドキュメントの同時更新。

### commits（コミットの規約違反）

根拠は CLAUDE.md の「コミット」。5 クラス以上を使う。

| class | 内容 |
|---|---|
| `bad-message` | Conventional Commits でない（接頭辞が無い、未知の type、コロンの後が空） |
| `non-english-message` | 件名が日本語 |
| `unknown-task-trailer` | `Task:` が存在しないタスク ID を指す |
| `failing-gate` | 型エラーやテストの失敗を含む変更をコミットする |
| `untracked-area` | `.dev/` や `.claude/settings.local.json` のファイルを強制的に追加する（`node_modules/` は複製ではリンクなので使わない） |

good は、規則どおりのコミット（`Task:` の行に存在するタスクを書く、ドキュメントだけの変更など）。ボードはコミットに含まれないので、タスクのファイルを stage しない。

### recall（記録の再利用）

対象は、ボードのタスク（タイトル・説明・メモ）と教訓、`docs/decisions/*.md`。期待する ID は `T-NNN` か `D-NNNN`（決定記録は 4 桁）。タスクを 4 件、決定記録を 4 件。

- 質問は、開発者が過去の経緯を探すときに自然に書く日本語の 1 文にする
- タイトルの丸写しはしない。内容を表す語は自然に含めてよい
- 答えが 1〜2 件に決まるものにする

## シナリオを書くときの決まり

- bad は、そのクラスの違反を **1 つだけ** 含める。それ以外は健全に保つ。違反そのものが型エラーやテストの失敗である場合を除き、編集後も `pnpm typecheck` と `pnpm test` が通ること（`defects` の `logic` は、型チェックが通ればよい）
- bad は、根拠の規則に照らして誰が見ても違反だと言えるものだけにする。意図を読み取らないと判断できない境目の例は入れない
- good は、編集後に `pnpm typecheck` と `pnpm test` が通り、CLAUDE.md のどの規則にも反しないこと
- 同じクラスの中で、ファイル・場所・書き方を変える（例: `any` なら `: any`、`as any`、`Record<string, any>`）
- 新しく足す決定記録には、かなり先の空いている番号を使う（`09xx`）。「既存の最大の次」を使うと、あとから足される本物の記録とぶつかる。タスクの番号はボードが決めるので、`$N` で指す
- 一時ディレクトリの複製で、上の条件を実際に確かめてから書く

## 一時ディレクトリの複製の作り方

```sh
export pnpm_config_verify_deps_before_run=false
root=~/github/nagaya
tmp=$(mktemp -d)
(cd "$root" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf -) | tar -xf - -C "$tmp"
ln -s "$root/node_modules" "$tmp/node_modules"
for p in tools/devboard tools/verify tools/harness spikes/agent-sdk spikes/desktop-shell spikes/electron-compare; do
  [ -d "$root/$p/node_modules" ] && ln -s "$root/$p/node_modules" "$tmp/$p/node_modules"
done
(cd "$tmp" && pnpm typecheck && pnpm test)
# ボードへの操作は、本物のボードの写しに当てて確かめる
board=$(mktemp -d)/board.sqlite
node -e 'const { DatabaseSync } = require("node:sqlite"); new DatabaseSync(process.argv[1]).exec(`VACUUM INTO '"'"'${process.argv[2]}'"'"'`)' "$HOME/.nagaya-dev/boards/nagaya.sqlite" "$board"
(cd "$tmp" && NAGAYA_BOARD="$board" node tools/devboard/src/ops-cli.ts '[{"op":"create_task","args":{"title":"試し"}}]')
```

- `pnpm_config_verify_deps_before_run=false` を必ず付ける。付けないと、pnpm が複製の中で `pnpm install` を始め、リンク先の `node_modules` を消そうとする
- 同じ理由で、`CI=true` は付けない
- 複製の `node_modules` は本物へのリンクなので、その下には何も書かない・消さない
- 本物のリポジトリの中では、シナリオの編集を試さない。ボードへの操作も、本物のボードには当てない（必ず写しの `NAGAYA_BOARD` を付ける）
