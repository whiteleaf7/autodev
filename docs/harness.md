# ハーネス

AI が自律して開発を回すための仕組み（ゲート、記録、次の手を決める役）と、その仕組み自体を測って改善する方法。AGENTS.md の「進め方」を機械的に支える。

考え方は、AI に研究を任せる仕組みを扱った 4 つの資料から取った。

- **評価**: 合否を機械的に出せること。文章の規則は、守ったかどうかを人や AI の注意に頼らず、検査にする
- **記録**: 次の周が読める形で結果を残すこと。うまくいかなかったことも残す
- **次の手を決める役**: 結果を見て、続けるか、変えるか、やめるかを選ぶこと
- **評価の切り離し**: 評価を、改善の対象から切り離すこと。改善に使う例と、最終的に測る例を分ける

## ゲート（`autodev check`）

コミットしてよいかを 1 つのコマンドで判定する。速い検査を先に行い、通ったら lint・型チェック・テストを実行する。

| 検査 | 見つけるもの | 実装 |
|---|---|---|
| 評価の緩め | テストの skip・削除・アサーションの無いテスト、tsconfig と `.oxlintrc.json` の緩め、検査スクリプトの無効化、`@ts-ignore`、理由の無い lint の除外、パッケージが検査から外れる変更 | `harness/src/checks/gate.ts` |
| コードの規約 | `127.0.0.1` 以外での待ち受け、npm / npx の実行、JSDoc の型の `any`（リポジトリに固有のもの、lint で見られないもの） | `harness/src/checks/conventions.ts` |
| 記録 | 形式の崩れた決定記録（形式の決まりは devboard が持ち、`devboard lint-decisions` に渡して調べる。決定記録が基点〈land では取り込み先も〉と変わっていなければ、呼ばない。タスクの決まりは、ボードに書く時点で devboard が断る） | `harness/src/checks/records.ts` |
| ドキュメント | 存在しないスクリプト・パス・決定記録・MCP ツールへの言及、設定が指す先の欠け。MCP ツールの名前は、`devboard tools` が返す登録済みの名前と照らす | `harness/src/checks/docs.ts` |
| 共通の規約 | AGENTS.md の共通の規約の区画の中身が、始まりの行に記録したハッシュと合うか（区画が無い AGENTS.md は見ない。CI でも動く）。autodev の最新の共通の規約と区画が違うときは、案内だけを出して止めない。区画は直接直さず、`autodev rules-sync` で更新する | `harness/src/checks/rules.ts` |
| 自分を判定する仕組み | CI（`.github/workflows/`）からゲートを回す行を消す・`continue-on-error: true` を足す（`loosened-ci`）、`.githooks/` のフックから `autodev hook` の呼び出しを消す（`neutered-hook`）、`.devboard.json` の `hiddenPaths` から基点にあったパスを外す（`unhidden-path`）。`.autodev/workflow.json` の項目を基点より緩める（`loosened-workflow`）・崩す（`broken-workflow-config`）。変更が、自分を判定する仕組みを同じ変更で外せないようにするため（T-268）。いまは observe | `harness/src/checks/self-guard.ts` |
| 取り込み先との差 | `--base <rev>`（land は `origin/main`）を渡したとき、HEAD と比べても出ず、`<rev>` と比べると出る緩め（`loosened-since-base`。もとの検査の名前を `[...]` で添える）。コミットのフックを `--no-verify` などで通らずに入った緩めを拾う。テストの減りは、範囲のどれかのコミットの本文の `Removed-test:` の行で通す。いまは observe | `harness/src/checks/since-base.ts` |
| 検査の mode | `.autodev/gate.json` の崩れ、検査の mode を基点より下げる変更（enforce → observe・off、observe → off。既定が observe の検査を enforce に上げた設定を消すのも含む）。この 2 つの検査の mode は、設定では変えられない | `harness/src/check-modes.ts` |
| lint | 待っていない Promise、`any`、理由の無い空の catch・空の関数、使っていない変数、import の循環（型だけの import も数える）、oxlint の correctness のルール | `pnpm lint`（oxlint と oxlint-tsgolint。設定は `.oxlintrc.json`） |
| 型と振る舞い | 型エラー、テストの失敗 | `pnpm typecheck`、`pnpm test` |

- **結果の再利用**: lint・型チェック・テストが通ったら、リポジトリの全ファイルの中身（と Node の版・OS・Chrome の有無）のハッシュを、`<git の共通のディレクトリ>/autodev-gate-cache.json` に記録する（worktree の間で共有。7 日で切れる、50 件まで）。同じ中身のゲートは、速い検査だけ回して、これらを飛ばす。手での `check`・コミットの pre-commit・`land` が同じ中身を検査する流れで効く（実測で 28 秒が 2 秒）。1 バイトでも変われば回し直す。CI（環境変数 `CI`）と `autodev check --no-cache`（または `AUTODEV_NO_CACHE`）では使わない。記録ファイルを書き換えて飛ばす抜け道は、`--no-verify` と同じ種類の迂回なので、していない
- 速さのため、基点（HEAD）のファイルは、テスト・package.json・tsconfig・lint と整形の設定を、`git cat-file --batch` で、最初の 1 回にまとめて読む（1 つずつ `git show` していたころは、速い検査が 10 秒近くかかった）。`autodev check` は、最後に、段ごとの所要時間を 1 行で出す。lint と型チェックは、並列に回す
- ゲートが待つ外のプロセス（git・devboard）には、1 つずつ上限の時間（120 秒。`AUTODEV_CHILD_TIMEOUT_MS` で変えられる）を付け、超えたらコマンドの名前を添えて失敗にする。pre-commit のゲートが、lint より前で何も出さずに 30 分止まったことがあり（T-286。原因のプロセスは記録から決められなかった）、止まった場所が出力で分かるようにするため。lint と型チェックは、子が終わったあとも裏に残ったプロセスが出力のパイプを握っていると、待たずに 1 秒で進め、そのことを出力に足す
- テストを lint・型チェックと同時に回す形は、採らなかった。手元（10 コア）の実測で、合計が 11.4〜11.9 秒 → 10.8〜12.0 秒と変わらない（CPU の取り合いで、テストが 8.6〜9.2 秒 → 9.8〜11.0 秒に延びる）。lint が落ちたときに、すぐ返る利点のほうを残す
- 検査は、いまの姿と基点（HEAD）を比べる。いまの姿は、`autodev check` では作業ツリー、コミットのとき（pre-commit が実行する `autodev check --staged`）は index（コミットされる中身）。テストの件数や、tsconfig と `.oxlintrc.json` の検査項目が基点より減ると止める
- `autodev check --base <rev>` は、HEAD に加えて `<rev>` とも比べる。land は、rebase のあとのきれいな作業ツリー（＝HEAD）を検査するので、HEAD と比べるだけでは何も比べられない。そこで `--base origin/main` を渡し、ブランチ全体の変更を取り込み先と比べる（上の表の「取り込み先との差」）
- 型チェックを `tsc --noEmit` から `bun check` に替えるのは、緩めではない（同じエラーを出す）。ただし package.json に `check` スクリプトがあると、`bun check` は型検査をせずそちらを動かすので、`--no-script` が無いものは止める（`harness/src/checks/gate.ts`）
- `.oxlintrc.json` に新しく `off` を足すときは、同じ行の後ろか、上の行に `// 理由` を書く（`.oxlintrc.json` は JSONC なのでコメントが書ける。続けて並ぶ `off` には、上の 1 つのコメントがかかる。インラインの除外と同じで、理由が無いと止める）。カテゴリで有効なだけのルールは `rules` に名前が無く、基点で有効だったかを名前では決められないので、理由を求める形にしている。基点で有効だったルールを `off` や `warn` にするのは、理由があっても止める
- lint の指摘は直す。意図したものだけ、`// oxlint-disable-next-line <ルール> -- 理由` で行ごとに外す（理由が無いものと、ファイルごとの除外はゲートが止める）
- タスク・教訓・マイルストーンは git の外の SQLite にある。書き込みが決まり（メモの無い done・cancelled・blocked、AI のタスクの review、子が残る親の done、切れた親・依存・マイルストーン、循環）に新しく反するなら、store が書かずに断る。ボードに書くのは AI だけ（ダッシュボードは読み取り専用。）で、もとからある問題（以前に画面から書かれたものなど）は断らず、`get_overview` の `problems` に出る
- 振る舞いを変えるタスク（`paths` か、`Task:` の行でそのタスクを指したコミットが変えたファイルに、`docs/` と `.md` 以外があるもの）を AI が `done` にするときは、どれかのメモに「動かした: `コマンド` → 結果」の行が要る。コマンドがテスト・型チェック・lint・ビルドだけなら断る（devboard の `src/rules.ts` の `closingProblems`）。コミットも見るのは、`paths` を書かずに閉じて決まりを抜けられないようにするため。コミットはすべてのブランチから探すので、取り込む前の worktree のコミットも数える。done にする瞬間だけを見るので、この決まりの前に閉じたタスクは `problems` に出ない。書き方と手段は `docs/verification.md` の「done にするときに残すもの」
- 検査を足す・変えるときは、止める例と通す例を `.autodev/eval/public/` に足し、`harness/test/` にテストを書く。新しい検査は observe で始める（下の「検査の mode」）
- テストの削除（件数の減り）は、手での `autodev check` では止める。コミットのときは、pre-commit のゲートが止めずに commit-msg へ回し、commit-msg が index と基点を比べて、件数の減ったファイルごとに本文の `Removed-test: <ファイル> -- <理由>` の行を求める。行がそろえば通す。不安定で原因を直せないテストを、回し直しや skip で残さずに消せるようにするため（`--no-verify` も決定記録も要らない）。skip とアサーションを抜く変更は、理由があっても止める。対象のコードごと消したテストは、いままでどおり数えない
- どうしても通せない正当な変更（上の行で通せないもの）は、理由を決定記録に残したうえで `git commit --no-verify` を使う

### 検査の mode（off / observe / enforce）

速い検査（上の表の、lint・型と振る舞いより前のもの）は、検査ごとに mode を持つ。lint・型チェック・テストは mode を持たない（lint のルールを試すときは、oxlint の `warn` を使う）。

- `enforce`: 見つけたら止める。設定も既定も無い検査は、これになる
- `observe`: 止めずに、何を止めたはずかを出力して記録に残す。新しい検査の誤検出を、実際の作業で見るための段。評価（`autodev eval`）は、autodev の既定で observe の検査も止める側で判定する（`AUTODEV_ENFORCE_DEFAULTS`。止める例のシナリオで、検査の中身を試すため）。プロジェクトの `.autodev/gate.json` で下げた mode は、そのまま使う
- `off`: 見ない
- autodev の既定は `harness/src/check-modes.ts` の `DEFAULT_MODES`（名前の無い検査は enforce）。プロジェクトは `.autodev/gate.json`（`{"checks": {"<検査の名前>": "observe"}}`。名前は出力の `[...]` の中のもの）で上げ下げできる。ただし基点より下げる変更はゲートが止める（`loosened-gate-mode`）。誤検出で下げたいときは、下げずに、通すべき例を `.autodev/eval/public/` に足して検査を直す。どうしても下げるときは、ほかの緩めと同じく、理由を決定記録に残して `--no-verify`
- 記録: observe の検査が見つけたものと、enforce の検査が止めたものを、`<git の共通のディレクトリ>/autodev-gate-log.jsonl` に 1 件 1 行で残す（worktree の間で共有。リポジトリには入らない）。`autodev gate-log` が、mode と検査ごとに、違う指摘の数・記録した回数・最後の日時と、回数の多い例を 3 件まで出す。`--check <名前>` で 1 つの検査の指摘をすべて出す。同じ中身を手での check・pre-commit・land が続けて検査するので、回数は同じ指摘が重なる。誤検出かどうかは、違う指摘の方で見る
- 同じ検査に何度止められても、ゲートは自動では通さない。enforce の検査は誤検出が無いのを確かめてから上げたものなので、通すと、止めるべき変更がそのまま main に入る。3 回続けて直らなければ、検査を緩めず、試したことと止めた指摘をタスクのメモに書いて `blocked` にし、ほかのタスクへ進む（共通の規約の「作業するとき」）。誤検出なら、その例を通す例として `public/` に足して検査を直すタスクにする

#### 検査を足すとき（observe で始める）

1. 検査を書き、止める例と通す例を `.autodev/eval/public/` に、テストを `harness/test/` に足す
2. `DEFAULT_MODES` に `"<検査の名前>": "observe"` で足して取り込む。使っているすべてのプロジェクトで、止めずに記録が始まる
3. しばらく作業してから、各プロジェクトで `autodev gate-log --check <名前>` を見る。誤検出があれば、その例を通す例として `public/` に足して検査を直す
4. 誤検出が無くなったら、`DEFAULT_MODES` から消して enforce にする。先に 1 つのプロジェクトだけで止めたいときは、そのプロジェクトの `.autodev/gate.json` で `enforce` にする（上げる変更は止めない）

### ゲートを回す流れ（`.autodev/workflow.json`）

プロジェクトは、待ち時間を減らすために、ゲートを回す流れを緩められる。無いときと、崩れているときは、いちばん慎重な流れ（下の既定）で動く。

| 項目 | 既定 | `false` にしたとき |
|---|---|---|
| `commitRunsSlowChecks` | `true` | コミットのゲート（pre-commit）は速い検査だけを回す。lint・型チェック・テストは land のゲートで回す。評価の緩めを止める速い検査は、コミットのたびに回る（land は rebase のあとの HEAD を見るので、HEAD と比べる検査がコミットでしか効かないため） |
| `landWaitsForCi` | `true` | land は PR の CI を待たずにマージする。main は land のゲートを通ってしか進まず、CI は main への push で回る |

- 開発者が 1 人の初期開発のように、CI と同じ検査を手元で済ませていて、待ち時間が効くときに使う。ほかの開発者が入る・公開する前に戻す
- 緩める変更は、自分を判定する仕組みの検査（`loosened-workflow`）が見る。いまは observe

## フック（`.githooks/`）

`pnpm install` が `git config core.hooksPath .githooks` と、`git blame` で書式だけのコミットを飛ばす `blame.ignoreRevsFile`（`.git-blame-ignore-revs`）を設定する。

- `pre-commit`: `.gitignore` で無視されているファイルの強制追加を止め、ステージしたファイルを整形してステージし直してから、`autodev check --staged` を実行する。`.autodev/workflow.json` の `commitRunsSlowChecks` が `false` なら、速い検査だけを回し、lint・型チェック・テストは land のゲートに任せる。通ったら、ステージした差分に引き金が当たった教訓を出す（止めない。「記録を引き出す」）。`--staged` は index を OS の一時ディレクトリに写し（`git checkout-index`。`git commit <パス>` や `-a` の一時的な index も GIT_INDEX_FILE から読む）、`node_modules` を 1 つずつリンクして、そこでゲートを回す。ステージしていない変更や追跡していないファイルで合否が変わらないようにするため（評価のシナリオ `pub-commits-09`・`pub-commits-10`）。lint・型チェック・テストには GIT_ で始まる環境変数を渡さない（linked worktree では git が GIT_DIR を絶対パスで渡し、テストの中の git が本物のリポジトリを指すため。L-008）
- `commit-msg`: 件名が Conventional Commits であること（件名の言語は見ない。プロジェクトの AGENTS.md の規約に任せる）、`Task:` の ID がボードにあること、テストを減らしたファイルごとに `Removed-test: <ファイル> -- <理由>` の行があることを確かめる（最後のものは `removed-test` の検査の mode に従う）
- `pre-push`: main への push を止める
- `post-commit` / `post-rewrite` / `pre-push`: roborev（AI のコードレビュー）が入っていれば、コミットのレビューを裏で積む／rebase や amend のあとにレビューを付け替える／push の前に積み残しを渡す。ゲートではないので、コミットは止めない。roborev が無い環境や、`HARNESS_SKIP_REVIEW` があるとき（ハーネスの評価のシナリオのコミット）は何もしない

## 返答の差し戻し（Stop フック）

ボードの `review` は store が断るが、会話の返答で「動作確認をお願いします」と頼むのは止められない。そこで、`.claude/settings.json` と `.codex/hooks.json` の Stop フックが、AI が返答を終えるたびに `harness/src/stop-hook.ts` を実行する。

- 最後の返答に、ユーザーに確かめさせる文（「確認してください」「試してみてください」「Please verify」など）があれば、`decision: "block"` で差し戻す。理由には見つけた文と、`docs/verification.md` の手段で自分で確かめるよう書く
- ログイン・支払い・OS の権限の許可・外部への公開のように、AI に物理的にできないことを含む文は通す
- 引用（「」『』、コード、`>` の行）の中は、頼みではなく言及として扱う。打ち消し（「確認してもらう必要はない」）も通す
- 差し戻したあとの返答（`stop_hook_active` が true）は見ずに通す。差し戻しが続いて止まらなくなるのを防ぐ
- 判断は `harness/src/stop-requests.ts` の純粋な関数で、見逃しの例と誤検出の例は `harness/test/stop-requests.test.ts`。誤検出や見逃しを見つけたら、先にテストに例を足してから直す

## 書式（Biome）

書式は Biome でそろえる。設定は `biome.json`（行幅 120・スペース 2・二重引用符・セミコロンあり）。

- `pnpm format` で、`tools/`・`apps/`・`packages/` の ts・js・json を整形する。`spikes/` と、ハーネスの評価のシナリオ（`.autodev/eval/`。`find` の文字列が当たらなくなるため）は対象にしない
- コミットのときは、pre-commit がステージしたファイルを整形してステージし直すので、手で整形しなくてよい。一部だけステージしたファイル（`git add -p`）は、ステージしていない変更が混ざらないように整形せず、そのことを表示する
- `autodev check` は書式を検査しない。書式は直せば済むことで、ゲートで止めるほどの問題ではない
- 書式だけを変えるコミットを作ったら、その hash を `.git-blame-ignore-revs` に足す

## AI のコードレビュー（roborev）

コミットのたびに、roborev のデーモンが Claude Code でそのコミットをレビューし、指摘を `~/.roborev` に溜める。指摘は閉じるまで残る。

指摘は、`autodev land` が取り込みの前に読ませる（下の「取り込み」の 1）。roborev の設定でコミットのあとのレビューを「まとめ待ち」にしている（`post_commit_batch_size`・`post_commit_quiet_period`）と、レビューは push の前（pre-push の `roborev post-commit --flush-push`）まで積まれない。land は push より先に指摘を読むので、読む前に同じ口でブランチのまとめ待ちを積み、終わるのを待つ（T-328。これが無かったころは、land が毎回「レビューが積まれていない」と出して進み、push のあとに走ったレビューの結果を誰も見ていなかった）。読む流れが無かったころは、nagaya の 151 件のレビューで High が 3 件あり、どれも本物の不具合だったのに、閉じた指摘も直した指摘も 0 件だった（nagaya の決定記録 0063・0066）。

- 止めるのは High（と Critical）が開いたままのときだけ。Medium・Low は表示だけにする。読むだけのレビューは誤検出もあり、すべてで止めると、理由を書いて閉じるだけの作業が増えるため。High は、直すか、直さない理由を書いて閉じれば通る
- 読むだけのレビューは、動かせば一度で分かる誤りも見落とすので、レビューの段数や effort は増やさない。中身のある指摘で検査の穴が見つかったら、先にその穴を突く評価のシナリオ（`.autodev/eval/public/`）を足して、`autodev eval --set public` で止まらないことを確かめてから直す。以後はシナリオがその穴を守る（例: job 23 の、カテゴリで有効なだけのルールを overrides で切る穴は `pub-eval-weakening-14`）

- 見る: `roborev job show HEAD`（コミットのレビュー）/ `roborev job list --open` / `roborev tui`
- 閉じる: 直したら、直したコミットと確かめたことを `roborev job comment --job <ID> "..."` に書いて `roborev job close <ID>`。直さない指摘は、理由を同じく comment に書いて close する（直すコミットを作っても、もとの job は開いたまま残る）
- 重い変更を深く見たいとき: `roborev review --reasoning high <コミット>`
- 設定はリポジトリではなく `~/.roborev/config.toml`（エージェント `claude-code`、モデル `claude-sonnet-5-5`、`review_reasoning = "medium"`、`isolate_reviews = true`）。Claude のサブスクの利用枠を使い、API キーは使わない
- フックは自前だが、roborev が自分のフックと見なす印（2 行目）と `ROBOREV=` の絶対パスを入れてあるので、`roborev doctor` も警告せず、`roborev init` も上書きしない。印やパスの行は消さない
- 匿名の利用統計は環境変数 `ROBOREV_TELEMETRY_ENABLED=0` で止める（config のキーは無い）。フックでも付けるが、手で起動するデーモンや CLI のために、シェルの設定（`~/.zshenv`）にも書いておく
- Claude Code のセッションの始めに、`.claude/settings.json` の SessionStart フックが `harness/src/roborev-doctor.ts` を実行する。`roborev doctor --json` に警告や失敗があれば、AI のコンテキストに「roborev の注意」として出る（承知のうえで残している警告は `harness/src/roborev.ts` の `ACCEPTED`）。roborev が入っていなければ何も出ない

### roborev のフックを新しい版に合わせる

roborev の更新でフックの版（印の `v5` など）が上がると、セッションの始めに `repo.hooks` の注意が出る。`roborev init` や `roborev hook install` では直さない（roborev の処理を先頭に差し込むので、`HARNESS_SKIP_REVIEW` の条件が効かなくなる）。

1. 使い捨てのリポジトリ（`git init` のあと `.githooks/` を作り、`git config core.hooksPath .githooks`）で `roborev hook install` を実行し、生成されたフックを読む
2. `.githooks/` の `post-commit`・`post-rewrite`・`pre-push` を見比べ、2 行目の印、`ROBOREV=` のパス、呼んでいるコマンドを新しい版に合わせる。`HARNESS_SKIP_REVIEW` と `ROBOREV_TELEMETRY_ENABLED` の行は残す。生成されるフックが増えていれば、同じ形で足す
3. `roborev doctor` で `repo.hooks` が ok になったことを確かめる。`autodev eval --set public` のあと、`roborev repo list` に評価用の複製が無いこと（評価の複製でレビューが積まれていないこと）を確かめる

## CI（GitHub Actions）

`.github/workflows/check.yml` が、PR と main への取り込みで `pnpm install --frozen-lockfile` と `autodev check` を実行する（）。ローカルのゲートと同じ 1 本で、CI のための検査は無い。

- ubuntu で動かす。ボード（SQLite）は無いが、ゲートはボードが無くても通る
- アクションはコミットの SHA で固定している（リポジトリの設定で必須）。上げるときは、タグの指す SHA を調べて書き換え、コメントの版も直す
- main は PR からしか進めない。必須のチェックと自動マージは GitHub Free の private では使えないので、`autodev land` が CI の結果を待ってからマージする。main に入ったあとの CI が落ちていたら、ローカルと CI の違いを直すタスクを足す
- PR の CI は、PR の中の `.github/workflows/` で動くので、PR が自分の CI を変えられる。そのため、取り込みを決めるのは land のローカルのゲート（autodev 自身を `--base origin/main` で回す）にし、CI は 2 段目とする。CI からゲートの行を消す変更は、`loosened-ci` が見る（T-268）
- リポジトリの設定（マージは rebase だけ、Actions の権限と SHA の固定の必須化）は。main のルールセットは、GitHub Free の private では使えないので、main への push は pre-push フックで止める

## 取り込み（`autodev land`）

ブランチを、PR を通して 1 件ずつ main に取り込む（）。main 以外のブランチの上で実行する。作業用の worktree でも、main の worktree の上のブランチでもよい。

1. `origin/main` を取ってきて、ブランチのコミットに付いた roborev の開いた指摘を一覧で出す（`roborev job list --branch <ブランチ>` と `roborev job show`）。High が開いたままなら、閉じ方を示して止まる。レビューが走っている間は 5 分まで待つ。終わっていない・積まれていない（`post_commit_batch_size` でまとめて待っている、失敗した、など）コミットは、そう表示して進む。rebase で SHA が変わる前に読み、ロックの外で読むので、ほかの取り込みを待たせない。roborev が無い環境では、見ていないことを 1 行出して進む。`HARNESS_SKIP_REVIEW` があるときは何もしない
2. git の共通ディレクトリの `autodev-land.lock` を取る。ほかの取り込み中は待つ（持ち主のプロセスが死んでいれば外す）
3. `origin/main` を取ってきて rebase する。衝突したら rebase を取り消し、衝突したファイルを示して止まる
4. `pnpm install --frozen-lockfile --offline` で依存を入れ直す。rebase で main から新しい workspace のパッケージや依存が入っても、着手のときの `node_modules` のままゲートが落ちないようにするため。ストアに無い依存が増えたときは止まるので、`pnpm install --frozen-lockfile` を実行してからやり直す
5. rebase した結果で、autodev のゲート（`check.ts`）を `--base origin/main` で直接回す。プロジェクトの `check` スクリプトは通さないので、取り込む変更が同じ変更で `check` を書き換えても、ゲートは外れない。フックの設定にも頼らないので、`core.hooksPath` が書き換えられていても効く。取り込み先と比べるので、コミットのフックを通らずに入った緩めも見る（T-268）
6. ブランチを `--force-with-lease` で push し、draft の PR を作る（同じブランチの開いた PR があれば使い回す）。本文は `## Summary` とコミットの件名の一覧、`Task:` の行
7. CI（`gh pr checks`）が終わるのを待つ。落ちたら、マージせずに止まる
8. PR を ready にし、CI を通したコミットのままのときだけ（`--match-head-commit`）rebase でマージする。マージしたブランチは GitHub が消す
9. GitHub の rebase マージはコミットを作り直すので、ブランチを `origin/main` に合わせ、ローカルの main を fast-forward する。main の worktree の上で実行したときは、main に戻ってブランチを消す

main は、ローカルのゲートと CI を通った状態でしか進まない。main への直接の push は pre-push フックが止める（GitHub Free の private ではルールセットが使えないため）。取り込み済みで変更の無い worktree とブランチは、`autodev prune` で片付ける。取り込み済みかはローカルの main と `origin/main` で見るので、main の worktree が別のブランチを開いていてもよい。worktree は `git worktree remove` で外し、ブランチは取り込み済みを確かめたものだけを消す。未コミットの変更や取り込まれていないブランチは残り、理由が表示される。

store は決定記録を main の worktree に書き、作業者はそこに git を打てない（、教訓 L-017）。作業者は報告に決定記録のファイルを書き、司令塔が自分のブランチに移して取り込む。報告から漏れても取り残さないよう、`get_overview` の `git.uncommittedDecisions` が main の worktree の未コミットの決定記録を挙げる。

## 作業者の Bash の分離

Agent ツールの `isolation: "worktree"` で動く作業者では、Claude Code が Bash のコマンドを実行の前に調べ、git の操作が自分の worktree の外（main の worktree）に向かないことを文面から確かめられないと、コマンドをまるごと断る（「too complex to verify that it stays inside the worktree」など）。断られたコマンドは一度も実行されない。調べるのは、コマンドの中に git の呼び出しがあるときだけ。

断られる形（git を含むコマンドで）:

- `$(...)` やバッククォートのコマンド置換。git の引数でなくても、同じコマンドのどこかにあれば断られる（`echo "$(date)" && git status`）
- 引用符なしのヒアドキュメント（`git commit -F - <<EOF`）。中で展開が起こりうるため
- git を含む文字列をシェルに渡す（`sh -c "git status"`）
- main の worktree への `cd` や `git -C`
- `-c core.hooksPath=…`

通る形:

- コマンドを分け、git の行には置換を入れない。値が要るときは、先に別のコマンドで取って、次のコマンドに書き写す
- コミットのメッセージは Write ツールで `.dev/` に書き、`git commit -F .dev/<ファイル>` で渡す（引用符つきの `<<'EOF'` も通るが、ファイルの方が確実）
- `cd <自分の worktree> && … && git …` の連結、パイプ、`for`、`git -c user.name=…`、変数を使ったパス
- 使い捨てのリポジトリ（`/tmp` や自分の worktree の `.dev/` の下）での `git init`・`git clone`・`git config`・`git worktree add`
- node の `child_process` から動かす git（テストの中など）。git を含まないコマンドは、ヒアドキュメントや `/tmp` への書き込みも通る

教訓 L-021・L-027・L-032・L-033 の要点は同じで、「git を含むコマンドを単純に分ける」。L-021 と L-032 は `/tmp`・変数のパス・入れ子のリポジトリへの `git config`・相対パスの `git worktree add`・ヒアドキュメントそのものも断られたと書くが、T-089 で打ち直すと、置換や引用符なしのヒアドキュメントが無ければ通った。当時のコマンドに置換が混ざっていたか、Claude Code の検査が変わったと見ている。上の一覧と違う断られ方をしたら、表示された理由のとおりに直し、教訓に残してこの一覧を直す。

## 記録を引き出す（`pnpm recall`）

```sh
pnpm recall "UI とデーモンの通信はどう決めた？"
```

- タスク（タイトル・説明・メモ）、決定記録、教訓を、質問との近さで並べて返す。MCP の `recall` も同じ
- 教訓は、うまくいかなかったこと・遠回りしたこと・環境の罠と、その対処。MCP の `add_lesson` でボードに残す
- 似た作業を始める前に引く。同じ失敗を次のセッションが繰り返さないための仕組みなので、気づいたらその場で残す
- 引き金のチェックリスト（T-264）: `recall` は引くかどうかがエージェントの注意に頼るので、差分から読み取れる教訓には `trigger`（変えたファイルのパスの接頭辞 `paths`、変えた行に現れる語 `words`、確かめること `check`）を付ける（`add_lesson`、あとからは `update_lesson`）。コミットのとき、pre-commit がゲートを通したあとで、ステージした差分に当たった教訓だけを出す（`devboard checklist`）。着手のときは、`get_task` がタスクの `paths` に当たった教訓を `checklist` に入れる。どちらも止めはしない。環境の罠（シェル・分離・ログイン）のように差分から読めない教訓には付けない。1 回の差分に 10 件を超えて出るようなら、引き金を狭める

## ハーネスを測る

ハーネスが、止めるべき変更をどれだけ止め、過去の記録をどれだけ引き出せるかを数える。形式と点数の定義は `harness/eval/SPEC.md`。

```sh
autodev eval --set public                        # 公開用のシナリオ。1 件ずつの結果が出る
autodev eval --set heldout --record     # 最終評価用。集計だけが出て、.autodev/history.jsonl に残る
```

- 速さのために、評価の複製のゲートは、(1) テストを、触ったパッケージと依存先だけに絞る（`AUTODEV_TEST_SCOPE=changed`。`test-scope.ts`）、(2) 「通った」記録を、複製の全部と実行の間で 1 つ共有する（`<.git>/autodev-eval-gate-cache.json`。鍵に基点のツリーと絞り込みを入れるので、リポジトリの中身が変われば前の記録は使われない。本物のゲートの記録とは別）。同じ中身をステージするコミットのシナリオは、1 件目が通ってから回す（`eval-order.ts`）。`--no-cache` と CI では記録を使わない。`--record`（最終評価）は、実行をまたいで使い回さず、その実行の中だけで共有する。実測（公開 60 件、10 コア）: 281 秒 → 記録が空で 158 秒 → 続けて回して 90 秒。判定は全件同じ（44/47）
- 評価と変異テストの一時物（テンプレート・複製・ボードの写し）は、OS の一時ディレクトリの下の 1 つの親ディレクトリ `autodev-run-<プロセス番号>-<乱数>/` にまとめる（`run-dir.ts`）。終わったとき、止められたとき（SIGINT・SIGTERM）に、親ごと消す。強制終了（SIGKILL）や電源断で残ったものは、次の評価か変異テストの始めに、持ち主のプロセスがいなくて 6 時間以上たったものだけ掃除する。リポジトリの中に置かないのは、複製がゲートの検査対象に混ざらないようにするため
- シナリオは「止めるべき変更（bad）」「通すべき変更（good）」「記録についての質問（query）」の 3 種類。作業ツリーの複製に当てて、ゲートやフックが止めるかを見る
- ボードは git の外の SQLite にあるので、ランナーは評価の始めにボードの写しを取り、シナリオごとに複製して `DEVBOARD_DB` で渡す。records のシナリオは、ボードへの操作（`pnpm board:apply` と同じ形）を写しに当て、断られたら「止めた」と数える。本物のボードには書かない
- シナリオが見本にするコード（devboard のストアやサーバなど）は、devboard のリポジトリ（入れてある `~/github/devboard`）の、切り出す前の姿のコミット（`harness/src/sandbox.ts` の `FIXTURE_COMMIT`）を `git archive` で取り出し、複製の中の `tools` の下の `devboard` ディレクトリに置く。コピーはリポジトリに持たない。コミットは変わらないので、devboard 本体が変わっても、シナリオが探す文字列は変わらない。依存は、入れてある devboard の `node_modules` を使う。浅い clone の devboard では、`git fetch --unshallow` で履歴を取る
- 点数は「止めた bad + 引き出せた query − 2 × 止めてしまった good」。何でも止めるゲートに点を与えないために、誤検出を重く引く
- `.autodev/eval/public/` は、改善の作業中に見てよい。ゲートの自己テストにもなる
- `.autodev/eval/heldout/` は最終評価用で、**改善する側は中身を読まない**。ランナーも集計しか出さない。読んでしまうと、その例に合わせた検査を書けてしまい、点数が実力を表さなくなる
- `recall`（MCP と `pnpm recall`）は、`paths` に `.autodev/eval/heldout/` を含むタスクの説明とメモ、そのタスクに結び付いた教訓の本文を返さない。タイトルと ID と、held-out を触った記録であることだけが出る。held-out を書く作業者がメモに中身を残しても、改善する側の目に入らないようにするため。held-out を触るタスクには、必ずこの `paths` を付ける

### ハーネスを改善するときの手順

1. `autodev eval --set heldout --record` で現在値を測る（集計だけを見る）
2. 弱い family について、起こりそうな例を自分で考え、`public/` にシナリオを足す
3. 検査やテストを直して、`autodev eval --set public` で確かめる
4. 最後に held-out をもう一度測り、`.autodev/history.jsonl` で前と比べる

守ること:

- 点数を上げるために、評価の側（`.autodev/eval/`、点数の定義、ランナー）を緩めない
- held-out を足す・入れ替えるときは、改善を担当しない別のエージェントに `SPEC.md` を渡して書かせる。メインは件数の報告だけを受け取る
- 外部のリポジトリから仕組みやコードを取り込むときは、自動では入れない。読んでから、決定記録を残して入れる

### テストの抜けを探す（変異テスト）

```sh
autodev mutate tools/verify/src/screenshot.ts
```

ソースに小さなバグ（条件の反転、境界のずれ、検証の削除など）を 1 つずつ入れて、そのパッケージの型チェックとテストが止めるかを見る。止められなかった行が、テストの確かめていない振る舞いになる。結果はファイルごとの「止めた数 / 全体」と、生き残った行の一覧で出る。

- パッケージのスクリプトが単純な形（`typecheck` が単独のコマンド、`test` が `node … --test … test/*.test.ts`）なら、pnpm を介さず直接回す（pnpm の起動だけで 1 回 0.3 秒かかるため。`mutate-command.ts`）。届くテストを先に、残りをあとに回し、同じテストは 2 度回さない。形が違うパッケージは、これまでの pnpm 経由
- 速さのため、変異を入れたファイルに相対パスの参照（import と、子プロセスに渡すパスの文字列）でたどり着くテストを先に回し、通ったときだけパッケージのテストを全部回す（`harness/src/related-tests.ts`）。生き残りの判定はいつも全部のテストなので、絞っても結果は変わらない
- 対象は、変えたファイルを指定する。かかる時間は 1 ファイルで数十秒から数分。全体を回す形（`--all`。nagaya で 597 件、約 50 分）はやめた（nagaya の決定記録 0065）。長くて回されなくなり、止められなかった 103 件の多くは振る舞いの変わらない変異で、テストを足す手がかりにならなかった。引数なしでは、使い方を出して止まる。進み具合は標準エラーに出る
- 1 件は 180 秒で打ち切り、止めたものとして数えたうえで「時間切れ」と分けて出す（変異で固まったテストのほか、負荷で遅れただけのこともある）。途中で止めても一時ディレクトリは残らない
- 並列で回すので、負荷で時間の当てが外れるテストがあると、そのテストが変異と関係なく落ち、どの変異も「止めた」に数えられる。振る舞いが変わらないはずの変異まで止まっていたら、まずそれを疑う
- 生き残りには、振る舞いが変わらない変異も混ざる。たとえば、範囲の外を `?? ""` で受けるループの `<` と `<=`、結果を変えないメモ化の削除、順位を変えない点数の係数。同時に動くプロセスの競合でしか通らない分岐や、本物の殻・Chrome を動かす `tools/verify` の通しのスクリプト（`docs/verification.md` の手段で確かめる）も、単体のテストでは止めない。それ以外の生き残りには、テストを足す

### 複製で pnpm を動かすときの注意

pnpm 11 は、複製の中で依存のずれを見つけると `pnpm install` を始め、リンク先の `node_modules` を消そうとする。複製では `pnpm_config_verify_deps_before_run=false` を必ず付け、`CI=true` は付けない。ランナー（`harness/src/sandbox.ts`）と、index の写しでゲートを回す `autodev check --staged`（`harness/src/snapshot.ts`）はこれを設定している。
