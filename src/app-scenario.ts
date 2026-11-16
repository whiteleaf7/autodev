// pnpm verify:app の筋書き: 本物の殻の UI からセッションを作り、指示を送り、ツールを承認して、ターンの終わりまでを通す。
// 操作も確認も殻の画面の中（POST /eval）で行い、UI が壊れていれば、どこで止まったかを名前で返す。
// 本物の claude の利用枠を抑えるため、指示は 1 回の Write だけで終わるものにする

import { z } from "zod";

export const PROOF_FILE = "nagaya-verify.txt";
export const PROOF_MD_FILE = "nagaya-verify.md";
export const PROOF_TEXT = "nagaya";

// link を渡すと、返事にそのリンクを入れさせる（--open-link。殻で押して既定のブラウザで開くかを確かめる）
export function prompt(link: string | null, openViewer = false): string {
  const file = openViewer ? PROOF_MD_FILE : PROOF_FILE;
  return [
    `Use the Write tool to create ${file} in this directory containing the single line "${PROOF_TEXT}".`,
    "Do not use any other tools.",
    link !== null
      ? `When you are done, reply with "Done." followed by the Markdown link [verification link](${link}) exactly as written.`
      : openViewer
        ? `When you are done, reply with "Done. See [${file}](${file})".`
        : 'When you are done, reply with just "Done."',
  ].join(" ");
}

// 画面の中で動かす本文（async の関数の中身。値は return で返す）
export type Step = {
  name: string;
  // 先に 1 回だけ実行する操作
  act?: string;
  // 真になるまで繰り返し確かめる
  until?: string;
  timeoutMs: number;
  // 確かめられたら殻の画面を撮る（.png の名前）
  snapshot?: string;
  // 確かめられたら、会話の画面から OBSERVE を読み取る（judge に渡す）。これ以降に画面が変わっても読み取りは残る
  observe?: boolean;
};

const fill = (selector: string, value: string) => `{
  const field = document.querySelector(${JSON.stringify(selector)});
  if (!field) throw new Error(${JSON.stringify(`${selector} が無い`)});
  field.value = ${JSON.stringify(value)};
  field.dispatchEvent(new Event("input", { bubbles: true }));
}`;

const click = (selector: string) => `{
  const button = document.querySelector(${JSON.stringify(selector)});
  if (!button) throw new Error(${JSON.stringify(`${selector} が無い`)});
  button.click();
}`;

const exists = (selector: string) => `return document.querySelector(${JSON.stringify(selector)}) !== null;`;

const START = "form.new button[type=submit]";
const ALLOW = ".permission button.allow";

// plugins は、有効にして起動した外のプラグインの ID。設定の画面で、すべて読まれて登録できたことを確かめる
export function scenario(cwd: string, link: string | null, plugins: readonly string[], openViewer = false): Step[] {
  const loaded = plugins.map((id) => `.plugin[data-plugin=${JSON.stringify(id)}][data-status="on"]`);
  const steps: Step[] = [
    {
      name: "UI がデーモンにつながる",
      until: exists('.app[data-connection="connected"]'),
      timeoutMs: 30_000,
    },
    ...(plugins.length === 0
      ? []
      : [
          {
            name: "有効にしたプラグインが、設定の画面ですべて読まれている",
            act: 'location.hash = "#/settings";',
            until: `return ${JSON.stringify(loaded)}.every((selector) => document.querySelector(selector) !== null);`,
            timeoutMs: 10_000,
            snapshot: "plugins.png",
          },
        ]),
    {
      name: "新しいセッションの画面が開く",
      act: 'location.hash = "#/new";',
      until: exists("form.new"),
      timeoutMs: 5_000,
    },
    {
      name: "作業ディレクトリと指示を入れると「Start」が押せる",
      act: `${fill("form.new [name=cwd]", cwd)}\n${fill("form.new [name=prompt]", prompt(link, openViewer))}`,
      until: exists(`${START}:not(:disabled)`),
      timeoutMs: 5_000,
    },
    {
      name: "「Start」を押すと、Write の承認の要求が画面に出る",
      act: click(START),
      until: `return document.querySelector("${ALLOW}:not(:disabled)") !== null && document.querySelector(".permission")?.textContent?.includes("Write") === true;`,
      timeoutMs: 120_000,
      snapshot: "permission.png",
    },
    {
      name: "「Allow」を押すと、承認の要求が消える",
      act: click(ALLOW),
      until: "return document.querySelector('.permission') === null;",
      timeoutMs: 15_000,
    },
    {
      name: "ターンの終わりが画面に出る",
      until: exists(".entry.turn"),
      timeoutMs: 120_000,
      snapshot: "turn-end.png",
      observe: true,
    },
  ];
  if (openViewer) {
    steps.push(
      {
        name: "会話のリンクまたはツールの行から Markdown ファイルを開く",
        act: `{
          const target = document.querySelector(".tool-file-link") || document.querySelector(".entry.assistant a.file-link") || document.querySelector(".entry.assistant button.file-link") || document.querySelector(".entry.assistant code.file-link");
          if (!target) throw new Error("ファイルリンクまたはツール行のリンクが無い");
          target.click();
        }`,
        until: exists(".viewer-panel .markdown-viewer"),
        timeoutMs: 10_000,
        snapshot: "viewer-markdown.png",
      },
      {
        name: "「本文」ボタンを押すと行番号つきテキストに切り替わる",
        act: click(".panel-action-btn"),
        until: exists(".viewer-panel .raw-viewer .code-lines"),
        timeoutMs: 5_000,
        snapshot: "viewer-raw.png",
      },
      {
        name: "「✕」ボタンを押すとビューアが閉じる",
        act: click(".panel-close-btn"),
        until: "return document.querySelector('.viewer-panel') === null;",
        timeoutMs: 5_000,
      },
    );
  }
  if (link === null) return [...steps, ...presetSteps()];
  const anchor = `.entry.assistant a[target=_blank][href=${JSON.stringify(link)}]`;
  return [
    ...steps,
    { name: "返事に受け口へのリンクが出る", until: exists(anchor), timeoutMs: 5_000 },
    {
      // 既定のブラウザに渡ったかは、受け口に届いた要求で app.ts が確かめる
      name: "リンクを押しても、殻の画面は会話のまま",
      act: click(anchor),
      until: `return location.hash.startsWith("#/sessions/") && document.querySelector(${JSON.stringify(anchor)}) !== null;`,
      timeoutMs: 5_000,
      snapshot: "link-clicked.png",
    },
    ...presetSteps(),
  ];
}

// 最近使った組とブックマーク（T-150）。ターンのあとの画面で、recently の更新、ブックマークの追加、ドラッグでの並べ替え、
// 画面を読み込み直したあとの順（デーモンに保存した順）を確かめる。読み込み直すと会話の画面は同じ形で戻らないので、
// 会話の読み取りは、ターンの終わりの直後に済ませてある（observe）
const BOOKMARKS = "[data-kind=bookmarks]";
const bookmarkNames = `[...document.querySelectorAll("${BOOKMARKS} .preset-name")].map((element) => element.textContent)`;
const VERIFY_ORDER = "verify-bookmark-order";

// 描き直しは微小タスクで済むので、待つのは微小タスクだけにする（ウィンドウが隠れている間はタイマーが止まる）
const settle = "for (let i = 0; i < 5; i += 1) await Promise.resolve();";

export function presetSteps(): Step[] {
  const toggle = ".bookmark-toggle";
  return [
    {
      name: "新しいセッションの画面に、いま使った組が最近使った組として出る",
      act: 'location.hash = "#/new";',
      until: `return document.querySelectorAll("[data-kind=recently] .preset-pick").length === 1;`,
      timeoutMs: 10_000,
      snapshot: "presets-recently.png",
    },
    {
      name: "いまの組をブックマークに足すと、ブックマークに 1 件出る",
      act: click(`${toggle}[data-bookmarked=false]`),
      until: `return document.querySelectorAll("${BOOKMARKS} .preset-row").length === 1;`,
      timeoutMs: 10_000,
    },
    {
      name: "モデルのチップを押すと、選択肢のメニューが開く",
      act: click("form.new [data-picker=model]"),
      until: exists(".picker-menu"),
      timeoutMs: 5_000,
    },
    {
      name: "既定でないモデルを選ぶと、別の組として足せる",
      act: click('.picker-menu [role=option]:not([data-value=""])'),
      until: exists(`${toggle}[data-bookmarked=false]`),
      timeoutMs: 5_000,
    },
    {
      name: "足すと、ブックマークが 2 件並ぶ",
      act: click(toggle),
      until: `return document.querySelectorAll("${BOOKMARKS} .preset-row").length === 2;`,
      timeoutMs: 10_000,
    },
    {
      name: "ハンドルをドラッグして、1 件目を 2 件目の下へ動かすと、並びが入れ替わる",
      act: `{
        window.verifyBefore = ${bookmarkNames};
        const handle = document.querySelector("${BOOKMARKS} .preset-handle");
        const rows = [...document.querySelectorAll("${BOOKMARKS} .preset-row")].map((row) => row.getBoundingClientRect());
        const box = handle.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const fire = (type, y) =>
          handle.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", button: 0, clientX: x, clientY: y, bubbles: true }));
        fire("pointerdown", box.y + box.height / 2);
        ${settle}
        fire("pointermove", rows[1].bottom - 2);
        ${settle}
        fire("pointerup", rows[1].bottom - 2);
      }`,
      until: `{
        const names = ${bookmarkNames};
        return names.length === 2 && names[0] === window.verifyBefore[1] && names[1] === window.verifyBefore[0];
      }`,
      timeoutMs: 10_000,
      snapshot: "presets-bookmarks.png",
    },
    {
      name: "画面を読み込み直しても、並べ替えた順のまま出る",
      act: `sessionStorage.setItem(${JSON.stringify(VERIFY_ORDER)}, JSON.stringify(${bookmarkNames}));
        setTimeout(() => location.reload(), 50);`,
      until: `{
        const expected = sessionStorage.getItem(${JSON.stringify(VERIFY_ORDER)});
        return window.verifyBefore === undefined && document.querySelector('.app[data-connection="connected"]') !== null && JSON.stringify(${bookmarkNames}) === expected;
      }`,
      timeoutMs: 30_000,
      snapshot: "presets-reopened.png",
    },
  ];
}

// 最後に画面から読み取るもの。judge が確かめる
export const OBSERVE = `
const texts = (selector) => [...document.querySelectorAll(selector)].map((element) => element.textContent?.trim() ?? "");
const turn = document.querySelector(".entry.turn");
return {
  tools: [...document.querySelectorAll(".transcript .tool")].map((tool) => ({
    name: tool.querySelector(".tool-name")?.textContent ?? "",
    status: tool.dataset.status ?? "",
  })),
  assistant: texts(".entry.assistant"),
  turn: turn ? { text: turn.textContent ?? "", isError: turn.classList.contains("error") } : null,
  alerts: texts("[role=alert]"),
  transcript: document.querySelector(".transcript")?.innerText ?? "",
};`;

export const Observed = z.object({
  tools: z.array(z.object({ name: z.string(), status: z.string() })),
  assistant: z.array(z.string()),
  turn: z.object({ text: z.string(), isError: z.boolean() }).nullable(),
  alerts: z.array(z.string()),
  transcript: z.string(),
});
export type Observed = z.infer<typeof Observed>;

// 画面に出たものと、作業ディレクトリに書かれたファイルの中身（無ければ null）から、通らなかった理由を挙げる
export function judge(observed: Observed, proofFile: string | null, openViewer = false): string[] {
  const problems: string[] = [];
  const fileName = openViewer ? PROOF_MD_FILE : PROOF_FILE;
  if (!observed.tools.some((tool) => tool.name === "Write" && tool.status === "done")) {
    problems.push(`画面に完了した Write が無い（ツール: ${JSON.stringify(observed.tools)}）`);
  }
  if (!observed.assistant.some((text) => text !== "")) problems.push("画面に claude の返事が無い");
  if (observed.turn === null) problems.push("画面にターンの終わりが無い");
  else if (observed.turn.isError) problems.push(`ターンがエラーで終わった: ${observed.turn.text}`);
  if (observed.alerts.length > 0) problems.push(`画面にエラーが出ている: ${observed.alerts.join(" / ")}`);
  if (proofFile === null) problems.push(`承認した Write の結果の ${fileName} が作業ディレクトリに無い`);
  else if (proofFile.trim() !== PROOF_TEXT) {
    problems.push(`${fileName} の中身が「${PROOF_TEXT}」でない: ${JSON.stringify(proofFile)}`);
  }
  return problems;
}
