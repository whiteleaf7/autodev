# 動かして確かめる

AI がアプリを動かし、結果を自分で確かめるための手段と準備。AGENTS.md の「判断と確認は AI が行う」を支える。

## 使える手段

| 確かめたいこと | 手段 | OS の許可 |
|---|---|---|
| ロジック | `pnpm test`、`pnpm typecheck` | 要らない |
| コミットしてよいか | `pnpm check`（`docs/harness.md`） | 要らない |
| Web の画面 | `autodev screenshot <url> <出力先.png> --wait-for <CSS セレクタ>` | 要らない |
| ネイティブのウィンドウが出たか | `autodev windows [--all] [持ち主の名前]` | 要らない |
| ネイティブのウィンドウの中身 | `screencapture -x -l <ウィンドウ ID> <出力先.png>` | 画面収録 |
| メモリ・プロセス | `footprint -p <pid>`、`ps -o pid,rss,command -p <pid>` | 要らない |

- **Web の画面（`autodev screenshot`）**: ヘッドレスの Chrome を DevTools Protocol で動かし、`--wait-for` の要素が出るまで待ってから撮る。モーダルなど操作のあとの画面は、`--click <CSS セレクタ>` で開き、入力欄は `--fill '<CSS セレクタ>=<値>'` で埋める（最後の `=` で分けるので、値に `=` は使えない）。`--click` と `--fill` は、コマンドラインに並べた順に 1 つずつ、要素が出るのを待ってから行うので、クリックの後に出る入力欄も埋められる。操作の後に出る要素は `--wait-after <CSS セレクタ>` で待つ。撮るまでに出た `console.error` と例外を `problems` に返すので、画面とあわせて確かめる。Chrome の場所は `VERIFY_CHROME` で変えられる
- **スマホの画面**: 上の Web の画面の撮影に `--mobile` を付ける。幅と高さを省くと 390×844 になり、別の機種の大きさは `--width` と `--height` で変える。2 倍の解像度で撮る（画像は 780px 幅）
- **ライトとダーク**: 上の Web の画面の撮影は、既定でライト（`prefers-color-scheme: light`）で描く。`--dark` を付けるとダークで描く（`--mobile` と合わせられる）
- **動き**: 上の Web の画面の撮影に `--later <ミリ秒>` を付けると、撮ったあとその時間だけ待って、同じページをもう 1 枚撮る（`<出力先>-later.png`）。`--reduced-motion` を付けると `prefers-reduced-motion: reduce` で描く
- **言語**: 上の Web の画面の撮影に `--lang <言語タグ>`（`ja`、`en-US` など）を付けると、`navigator.languages` と `Intl` の既定をその言語にして描く
- **ウィンドウの一覧（`autodev windows`）**: 画面に出ているウィンドウを JSON で出す（持ち主、pid、ID、位置と大きさ）。画面収録の許可がなくても、ウィンドウが出たかと大きさは分かる。題名は許可があるときだけ入る。`screenCaptureAllowed` で許可の有無も分かる。ステージマネージャの別のステージや最小化で画面に出ていないウィンドウは、`--all` で含める（`onScreen` が false になる）
- **ネイティブのウィンドウの中身**: ウィンドウそのものを撮るときだけ使う。許可がないと、壁紙とメニューバーしか写らない（エラーにはならないので、`screenCaptureAllowed` を先に見る）
- 撮った画像は `.dev/verify/` に置く（git 管理外）。確かめたら消す

## done にするときに残すもの

テストと型チェックは、コードと同じ思い込みで書いたものを確かめるだけなので、通っても実際に動くとは限らない。振る舞いや画面を変えたタスク（`paths` に `docs/` と `.md` 以外があるもの）は、上の手段で実際に動かし、`done` のメモに次の行を入れる。無ければ store が断る。

```text
動かした: `<実際に実行したコマンド>` → <結果。出力の要点、撮った画像の場所など>
```

- コマンドはインラインコードで書く。`pnpm test`・`pnpm typecheck`・`pnpm lint`・`pnpm check`・ビルドだけの行は、証拠に数えない
- 1 つのメモに何行あってもよく、前のメモに書いた行でもよい
- 何を動かすかの目安: 画面は Web の画面の撮影、ネイティブのウィンドウはウィンドウの一覧、CLI やサーバは起動して出力や応答を見る、ボードの決まりは `DEVBOARD_DB` で写しを指して `pnpm board:apply`、ハーネスは `pnpm harness:selftest`
- docs だけのタスクと、`paths` の無いタスクは対象外。`paths` は着手の前に書く（並行の判断にも使う）

## ユーザーに一度だけしてもらう準備

AI は自分の権限の設定を書き換えられない（Claude Code の auto モードが「自己改変」として止める）。次の 2 つはユーザーが行う。

### Claude Code の許可（`.claude/settings.local.json`）

```sh
cp ~/github/autodev/verify/settings.local.example.json .claude/settings.local.json
```

- 許可するのは、workspace のスクリプト（`pnpm --filter @repo/* ...`）と `screencapture`
- `autoMode.environment` で、このリポジトリのツールチェーンを信頼してよいことを安全判定に伝える
- `.claude/settings.local.json` は git 管理外で、この Mac だけに効く。すでにあるときは、雛形の中身を手で混ぜる

### 画面収録の許可（ネイティブのウィンドウを撮るときだけ）

システム設定 → プライバシーとセキュリティ → 画面とシステムオーディオ録音 で、Claude Code を動かしているアプリを許可する。許可したらそのアプリを起動し直す。

- 許可がなくても、Web の画面はヘッドレスの Chrome で撮れるので、多くの確認はこれで足りる
