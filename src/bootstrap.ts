// 自律開発基盤（devboard・harness・verify・フック・CI・AGENTS.md / CLAUDE.md）を新しいディレクトリへ展開して初期化する。
//   pnpm bootstrap <対象ディレクトリ> [--name <プロジェクト名>] [--title <製品表示名>] [--summary <概要>] [--files-only]

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

const SOURCE_ROOT = resolve(import.meta.dirname, "../../..");

const USAGE =
  "使い方: pnpm bootstrap <対象ディレクトリ> [--name <プロジェクト名>] [--title <製品表示名>] [--summary <概要>] [--files-only]";

export type BootstrapOptions = {
  targetDir: string;
  name: string;
  title: string;
  summary: string;
  filesOnly: boolean;
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

export function renderPackageJson(name: string, title: string): string {
  const rootPkg = JSON.parse(readFileSync(join(SOURCE_ROOT, "package.json"), "utf8")) as Record<string, unknown>;
  return `${JSON.stringify(
    {
      name,
      displayName: title,
      private: true,
      type: "module",
      packageManager: rootPkg.packageManager,
      engines: rootPkg.engines,
      scripts: {
        board: "pnpm --filter @repo/devboard start",
        "board:open": "pnpm --filter @repo/devboard open",
        "board:tailscale": "pnpm --filter @repo/devboard tailscale",
        "board:import": "pnpm --filter @repo/devboard import-history",
        "board:show": "node tools/devboard/src/board-cli.ts",
        "board:apply": "node tools/devboard/src/ops-cli.ts",
        typecheck: "pnpm -r typecheck",
        test: "pnpm -r test",
        check: "node tools/harness/src/check.ts",
        format: "biome format --write",
        lint: "oxlint",
        recall: "node tools/devboard/src/recall-cli.ts",
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

export function renderAgentGuide(name: string, title: string): string {
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

## 進め方（AI がオーケストレーションする）

このプロジェクトでは、ユーザーは大まかな「やりたいこと・直したいこと」だけを伝え、分解・順序づけ・実行・記録は AI が受け持つ。開発ボード（MCP \`devboard\` または \`pnpm board:show\` / \`pnpm board:apply\`）がその台帳になる（決定記録 0039）。

### 判断と確認は AI が行う

ユーザーの判断を待つと、それがブロッカーになって開発が止まる。だから、判断も結果の確認も AI が自分で行う。

- 方針が分かれるもの（プロダクトの方針、未決事項、設計の選択）も、AI が選択肢を比べて決める。決めた理由は \`create_decision\` か \`note\` に残し、ユーザーが後から覆せるようにする
- 結果は、テスト・型チェック・画面のスクリーンショット・実際の動作で AI が確かめ、確かめられたら \`done\` にする
- ユーザーに確認してもらうための \`review\` は使わない。返答で「動作確認をお願いします」と頼むのも同じで、Stop フックが差し戻す（\`docs/harness.md\`）
- 例外は、AI には物理的にできないことだけ。たとえば、ユーザーのアカウントへのログイン、支払い、OS の権限の許可、外部への公開。こういうタスクは \`blocked\` にして、ユーザーにしてほしいことを \`note\` に書き、他のタスクを先に進める
- 消すと戻せない操作（ユーザーのデータの削除、履歴の書き換え）は行わない。必要なら上の例外として扱う

### 依頼を受けたとき

- 依頼そのものを親タスクとして \`create_task\` で登録する。\`description\` にはユーザーの依頼文を言い換えずに残す
- 1 セッションで終わる大きさの子タスク（\`parent\` に親の ID）に分ける。各子タスクの \`description\` には、目的と完了の条件を書く
- 順番があるものは \`dependsOn\` でつなぐ。急ぎは \`priority: high\`
- 当てはまるマイルストーンがあれば \`milestone\` を付ける。なければ \`set_milestone\` で足してよい
- 小さな修正（1 回の変更で終わるもの）は分解せず、1 つのタスクとして登録する
- 分解の結果は、ユーザーに短く伝えてから作業に入る。確認は待たない

### 作業するとき

- 着手するタスクは \`get_overview\` の \`next\` から選ぶ。\`update_task\` で \`status: doing\` にし、ブランチがあれば \`branch\` を入れる
- 区切りごとに \`note\` で、やったこと・判断・次にやることを残す。次のセッションはこれを読んで再開する
- 似た作業を始める前に、MCP の \`recall\`（または \`pnpm recall "<質問>"\`）で過去のタスク・決定記録・教訓を引く
- うまくいかなかったこと、遠回りしたこと、環境の罠は、対処と一緒に \`add_lesson\` で残す。次のセッションが同じ失敗を繰り返さないため
- ダッシュボードは見るだけで、ボードに書くのは AI だけ（決定記録 0038）。ユーザーは AI に頼んで登録・編集する。以前に画面から書かれた \`createdBy: user\` のタスクや \`by: user\` のメモはユーザーの指示として扱い、作業の前に \`get_task\` で確認する。ユーザーが変えた状態や優先度を、理由なく戻さない（誰がいつ変えたかは \`get_task\` の \`history\` にある）
- 途中で分かった追加の作業は子タスクとして足す。進められないときは \`blocked\` にして、理由を \`note\` に書く
- 終わったら、結果を自分で確かめてから \`done\` にする。確かめ方は \`docs/verification.md\`。確かめられないうちは \`doing\` のまま、足りない確認の手段を作る
- テストはコードと同じ思い込みで書くので、通っても実際に動くとは限らない。振る舞いや画面を変えたタスク（\`paths\` か、\`Task:\` の行でそのタスクを指したコミットに docs 以外があるもの）は、実際に動かして確かめ、\`done\` のメモに「動かした: \`コマンド\` → 結果」の行を入れる（結果は、出力の要点や撮った画像の場所）。テスト・型チェック・lint・ビルドだけのメモでは、store が断る
- 子タスクがすべて終わったら、親タスクも閉じる
- 不要になったタスクは消さずに \`cancelled\` にし、理由を \`note\` に残す
- 設計上の判断（ライブラリ、構成、データ形式、プロトコル）をしたら \`create_decision\` で記録する。覆すときは新しい記録を作り、古い方を \`置き換え\` にする
- ボード（タスク・教訓・マイルストーン）は git の外の SQLite にある（決定記録 0011）。MCP が使えないときは、読み取りは \`pnpm board:show\`（\`tools/devboard/src/board-cli.ts\`）、書き込みは \`pnpm board:apply '<操作の JSON の配列>'\`（MCP のツールと同じ名前と入力の形。\`tools/devboard/src/ops.ts\`）を使う。ボードのファイルは直接触らない
- ボードの決まりに反する書き込み（メモの無い done・cancelled・blocked、動かした結果の無い振る舞いのタスクの done、AI のタスクの review、子が残る親の done など）は、store が断る。断られたら、表示された理由のとおりに直して書き直す

### まとめて頼まれたとき（\`/goal\` など）

「未着手をすべて進めて」「M1 を終わらせて」のように、ボードのタスクをまとめて頼まれることがある。次の手順で回す。

- \`list_tasks\`（または \`pnpm board:show tasks --status todo --detail\`）に対象を渡して取る
- \`ready\` のものを \`order\` の順に 1 件ずつ進める。1 件終わるたびに \`list_tasks\` を取り直す（作業中に足した子タスクや、依存が解けたタスクが増えるため）
- \`closable\` の親は、子の結果をまとめて閉じる
- 方針の判断が要るタスクも、上の「判断と確認は AI が行う」に従って自分で決めて進める
- 終える条件: 対象に \`ready\` が 0 件になったとき。最後に、終えたタスク、AI が下した主な判断、\`blocked\` と \`stuck\`（\`get_overview\` にも出る）のタスクとその理由をユーザーに返す
- コミットは下の「コミット」に従い、区切りごとに自分の判断で行う

### 並行で進めるとき（司令塔と作業者）

長く回すほど、メインのセッションのコンテキストが効いてくる。だから、メインのセッションは管理だけをし、タスクの作業はタスクごとの作業者（サブエージェントや別セッション）に任せる。作業者は、1 つのタスクを 1 つの worktree で最後まで進める。仕組みと実験の結果は決定記録 0010 と 0011。

- 司令塔（メインのセッション）: 着手するタスクを選んで \`doing\` にし、作業者を起動するだけにする。コードやログは読まない。並行させてよいのは、\`list_tasks\` で \`ready\` かつ \`overlaps\` が空のものだけ。着手させる前に、タスクの \`paths\`（触る予定のパスの接頭辞）を書く。\`paths\` が空のタスクは、ほかと並行させない。同時に動かす作業者は 3 つまで
- 作業者の起動:
  - Claude Code のサブエージェントなら \`isolation: "worktree"\`、\`run_in_background: true\`
  - Codex や他のエージェントなら \`git worktree add .worktrees/<名前> -b <ブランチ>\` で worktree を分けて動かす
  - 渡すのはタスク ID と「AGENTS.md の『作業者の手順』に従う」だけ。説明はボードにあるので、プロンプトに書き写さない。作業者には、実装・確認・コミット・取り込みまでを任せる
- 報告を受けたら、\`list_tasks\` を取り直して次を選ぶ。\`get_overview\` の \`git.uncommittedDecisions\` に決定記録が残っていれば、報告に無くても、自分のブランチに移して \`pnpm land\` で取り込む。作業者が \`blocked\` にしたものは、理由をユーザーへの最後の報告に含める

### 作業者の手順

- 最初に \`get_task\`（または \`pnpm board:show task <ID>\`）で目的と完了の条件を読み、\`recall\`（または \`pnpm recall "<質問>"\`）で似た記録を引く。\`pnpm install --frozen-lockfile --offline\` を実行する
- 自分の worktree の中で、実装・確認・コミットまでを済ませる。サブエージェントは呼ばない
- 分離環境では、git を打つコマンドに \`$(...)\`・バッククォート・引用符なしのヒアドキュメント（\`<<EOF\`）・\`sh -c "git …"\` を入れず、main の worktree への \`cd\` や \`git -C\` と \`-c core.hooksPath\` を使わない。コミットのメッセージはファイルで \`.dev/\` に書いて \`git commit -F .dev/<ファイル>\` で渡す（形の一覧は \`docs/harness.md\` の「作業者の Bash の分離」）
- ボードには、どの worktree からでも MCP または \`pnpm board:apply\` で書いてよい（すべて同じ SQLite に入り、コミットは要らない）
- 決定記録は main の worktree に書かれ、作業者はそこに git を打てない。作業者が決定記録を書いたら、司令塔への報告にそのファイルを書く。司令塔が自分のブランチに入れて \`pnpm land\` で取り込む
- 終わったら、自分の worktree で \`pnpm land\` を実行する。origin/main に rebase してゲートを通し、PR を作って CI が通ったらマージする。ほかの取り込みが終わるまで待つ。衝突したら \`git rebase origin/main\` で解消して、もう一度 \`pnpm land\`。CI が落ちたら、直してコミットし、もう一度 \`pnpm land\`（同じ PR を使い回す）
- 取り込んでから、確かめたことをメモに書いて \`done\` にする。司令塔への報告は、結果・取り込んだコミット・残った問題の 3 行ほどにする
- 使い終わった worktree は、司令塔が main の worktree で \`pnpm worktree:prune\` を実行して片付ける

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

## コードの書き方

読みやすく、後からリファクタリングしなくて済むコードを最初から書く。

- 名前で意図が伝わるようにする。コメントは「なぜそうしたか」だけを書き、コードを読めば分かることは書かない
- 冗長に書かない。同じ処理を重ねて書かず、使わないコード・引数・オプション・分岐を残さない
- ただし早すぎる抽象化もしない。共通化は、同じ形が実際に繰り返されてからにする
- 型は zod のスキーマを唯一の定義にして \`z.infer\` で得る。\`any\` は使わず、\`as\` は外部との境界でだけ使う
- 入力・ファイル・外部プロセスとの境界で検証し、内側では検証済みの値を信頼する。エラーは握りつぶさず、利用者が直せる言葉で返す
- 判断のロジックは副作用（ファイル・ネットワーク・プロセス）から分けて、純粋な関数にしてテストする
- 関数とファイルは 1 つの責務に保つ。モジュールの依存を循環させない
- 既存のパターンと命名に合わせる。新しいライブラリや構成を入れるときは決定記録を残す
- テストは実装の内部ではなく振る舞いを確かめる。バグを直すときは、先に再現するテストを書く
- 書き終えたら差分を読み直し、冗長な箇所や不要な抽象を削ってからコミットする
- 依頼と関係のない改善点を見つけたら、その場で混ぜずにタスクとして登録する

## コミット

AI 自律開発を目指しているので、コミット・push・PR のマージは、ユーザーの指示を待たずに AI が自分の判断で行う。push と PR は \`pnpm land\` を通して行い、手で \`git push\` しない。

- 意味のまとまりごとにコミットする。1 つのタスクが大きければ、区切りごとに分けてよい
- メッセージは Conventional Commits（\`feat:\` \`fix:\` \`docs:\` \`chore:\` \`test:\` \`refactor:\` など）で、簡潔な英語にする
- ボードのタスクに対応するコミットは、本文に \`Task: T-NNN\` を入れる
- ボード（タスク・教訓・マイルストーン）は git の外にあるので、コミットに含めるものは無い。決定記録はリポジトリにあり、関係する変更と同じコミットに含める。\`create_decision\` と \`set_decision_status\` は main の worktree のファイルを書くので、作業用の worktree で作業しているときは、そのファイルを自分の worktree に移して（\`set_decision_status\` で変わったものは、main の worktree の側を \`git restore\` で戻して）コミットする
- コミットの前に \`pnpm typecheck\` と \`pnpm test\` を通す
- この 2 つと lint を含むゲートが \`pnpm check\` で、\`.githooks/\` のフックがコミットのたびに実行する。メッセージの形式と \`Task:\` の行もフックが確かめる。止められたら、表示された理由を直す（\`--no-verify\` で飛ばすのは、理由を決定記録に残したときだけ）
- \`tools/harness/eval/heldout/\` は、ハーネスの最終評価用のシナリオ。中身を読まない（読むと評価が意味を失う。\`docs/harness.md\`）
- \`git add\` はパスを指定する（\`-A\` や \`.\` を使わない）。他のセッションが作業中の変更を混ぜないため
- \`main\` には直接コミットも push もしない（pre-push フックが止める）。作業はブランチで行い、区切りごとに \`pnpm land\` で取り込む。\`pnpm land\` が、ゲート・push・draft の PR・CI を待つ・rebase でのマージ・ローカルの main の更新までを行う（決定記録 0015）
- 作業用の worktree を作るときは、main の worktree で \`git worktree add .worktrees/<名前> -b <ブランチ>\`（または \`.claude/worktrees/<名前>\`）を実行する。main の worktree の上で \`git switch -c <ブランチ>\` してもよい（\`pnpm land\` が main に戻す）

## 作業ルール

- パッケージマネージャは pnpm。npm / npx は使わない
- Node の TypeScript 直接実行を使う。import には \`.ts\` 拡張子を付け、enum や namespace など型の除去だけで消えない構文は使わない（\`erasableSyntaxOnly\`）
- ローカルで待ち受けるサーバは \`127.0.0.1\` のみにし、Host を確認する
- ユーザーにサーバのアドレスを伝えるときは、\`127.0.0.1\` ではなく Tailscale の URL（\`https://<Mac の名前>.<tailnet>.ts.net:<ポート>/\`）を貼る。ユーザーはスマホなど別の端末から開くため。ダッシュボードは \`pnpm board:tailscale\` を実行し、出力された URL を使う。Tailscale が動いていないときだけローカルの URL を貼り、その理由を添える
- \`.dev/\` はローカルの一時ファイル（git 管理外）
- 仕様や構成を変えたら、関係するドキュメント（README、\`docs/\`）も同じ変更で直す
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
- \`tools/devboard/\`: 開発ダッシュボード（Web UI）・MCP サーバ・CLI（\`@repo/devboard\`）
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
    devboard/           # 開発ボード Web UI・MCP サーバ (devboard)・CLI・SQLite ストア (@repo/devboard)
    harness/            # ゲート (pnpm check)・評価ハーネス・取り込み (pnpm land)・Stop フック・bootstrap (@repo/harness)
    verify/             # ヘッドレス Chrome による画面確認・待機ツール (@repo/verify)
  docs/
    product.md          # プロダクト仕様・マイルストーン・未決事項
    architecture.md     # このファイル
    verification.md     # AI の自己確認手順
    harness.md          # ハーネスの仕組みと改善手順
    decisions/          # 設計判断の記録 (ADR: NNNN-slug.md)
\`\`\`

## 開発ボードと MCP / CLI (\`tools/devboard\`)

- **保存先**: git の外の SQLite（既定は \`~/.devboard/boards/${name}.sqlite\`、\`DEVBOARD_DB\` で変更可。決定記録 0011）。変更はすべてイベント表に追記し、同じトランザクションで現在状態の表を更新する
- **MCP サーバ (\`devboard\`)**: \`tools/devboard/src/mcp.ts\`（\`.mcp.json\` および \`.codex/config.toml\` で登録）。\`get_overview\`、\`list_tasks\`、\`get_task\`、\`create_task\`、\`update_task\`、\`set_milestone\`、\`list_decisions\`、\`get_decision\`、\`create_decision\`、\`set_decision_status\`、\`open_dashboard\`、\`recall\`、\`add_lesson\` を提供する
- **CLI (\`pnpm board:show\` / \`pnpm board:apply\` / \`pnpm recall\`)**: \`tools/devboard/src/board-cli.ts\`・\`tools/devboard/src/ops-cli.ts\`・\`tools/devboard/src/recall-cli.ts\`。MCP を使わないエージェントやシェルからも同じ読み書き・検索ができる（決定記録 0039）
- **Web ダッシュボード**: \`tools/devboard/src/server.ts\`（\`pnpm board\` / \`pnpm board:open\` / \`pnpm board:tailscale\`）。\`127.0.0.1\` で待ち受け、タスク一覧・詳細と活動グラフ（\`/activity\`、決定記録 0017）を読み取り専用で表示する（決定記録 0038）

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
  if (existsSync(join(targetDir, "package.json"))) {
    throw new Error(`${targetDir} にはすでに package.json がある。空のディレクトリを指定する`);
  }
  mkdirSync(targetDir, { recursive: true });

  for (const rel of ROOT_FILES) {
    const src = join(SOURCE_ROOT, rel);
    if (!existsSync(src)) continue;
    const dst = join(targetDir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
  writeFileSync(
    join(targetDir, "pnpm-workspace.yaml"),
    'packages:\n  - "apps/*"\n  - "packages/*"\n  - "tools/*"\n  - "spikes/*"\n',
  );

  copyTreeFiltered(join(SOURCE_ROOT, ".githooks"), join(targetDir, ".githooks"));
  copyTreeFiltered(join(SOURCE_ROOT, "tools/devboard"), join(targetDir, "tools/devboard"));
  copyTreeFiltered(
    join(SOURCE_ROOT, "tools/harness"),
    join(targetDir, "tools/harness"),
    (rel) => rel.startsWith("eval/heldout/") && rel !== "eval/heldout/.gitkeep",
  );
  for (const rel of VERIFY_FILES) {
    const src = join(SOURCE_ROOT, "tools/verify", rel);
    if (!existsSync(src)) continue;
    const dst = join(targetDir, "tools/verify", rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
  const verifyPkg = JSON.parse(readFileSync(join(SOURCE_ROOT, "tools/verify/package.json"), "utf8")) as Record<
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
    const src = join(SOURCE_ROOT, "docs/decisions", decision);
    if (existsSync(src)) cpSync(src, join(targetDir, "docs/decisions", decision));
  }
  const decision39Src = existsSync(join(SOURCE_ROOT, "docs/decisions/0040-multi-agent-and-bootstrap.md"))
    ? join(SOURCE_ROOT, "docs/decisions/0040-multi-agent-and-bootstrap.md")
    : join(SOURCE_ROOT, "docs/decisions/0039-multi-agent-and-bootstrap.md");
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

  writeFileSync(join(targetDir, "package.json"), renderPackageJson(name, title));
  writeFileSync(join(targetDir, "AGENTS.md"), renderAgentGuide(name, title));
  writeFileSync(join(targetDir, "CLAUDE.md"), "@AGENTS.md\n");
  writeFileSync(join(targetDir, "README.md"), renderReadme(name, title));
  writeFileSync(join(targetDir, "docs/product.md"), renderProductDoc(name, title));
  writeFileSync(join(targetDir, "docs/architecture.md"), renderArchitectureDoc(name, title));
  writeFileSync(join(targetDir, "docs/verification.md"), renderVerificationDoc());
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

  const initScript = `
    import("./tools/devboard/src/store.ts").then(({ updateProject, setMilestone, createTask, readTasks }) => {
      updateProject((p) => ({
        ...p,
        name: ${JSON.stringify(opts.title)},
        summary: ${JSON.stringify(opts.summary)},
      }));
      setMilestone({
        id: "M0",
        title: "開発基盤の整備",
        goal: "AI 自律駆動の仕組み（開発ボード・MCP / CLI・ハーネス・画面確認ツール）を整える",
        status: "done",
      });
      if (readTasks().tasks.length === 0) {
        createTask({
          title: "開発基盤とダッシュボード環境を整備する",
          description: "自律開発基盤とダッシュボードのツールを展開し、新規プロジェクトを進められる準備を行う。",
          status: "done",
          priority: "high",
          milestone: "M0",
          paths: ["tools/", "docs/", ".githooks/", ".github/"],
          note: "動かした: \`pnpm bootstrap\` → 開発基盤の展開・pnpm check・初期コミットが完了",
        });
      }
    });
  `;
  run("node", ["-e", initScript]);

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

if (import.meta.main) {
  try {
    const opts = parseBootstrapArgs(process.argv.slice(2));
    bootstrapProject(opts);
    console.log(`bootstrap: ${opts.title} (${opts.name}) を ${opts.targetDir} に用意した`);
  } catch (e) {
    console.error(`bootstrap: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
