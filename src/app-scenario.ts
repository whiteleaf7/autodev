// pnpm verify:app の筋書き: 本物の殻の UI からセッションを作り、指示を送り、ツールを承認して、ターンの終わりまでを通す。
// 操作も確認も殻の画面の中（POST /eval）で行い、UI が壊れていれば、どこで止まったかを名前で返す。
// 本物の claude の利用枠を抑えるため、指示は 1 回の Write だけで終わるものにする

import { z } from "zod";

export const PROOF_FILE = "nagaya-verify.txt";
export const PROOF_TEXT = "nagaya";

// link を渡すと、返事にそのリンクを入れさせる（--open-link。殻で押して既定のブラウザで開くかを確かめる）
export function prompt(link: string | null): string {
  return [
    `Use the Write tool to create ${PROOF_FILE} in this directory containing the single line "${PROOF_TEXT}".`,
    "Do not use any other tools.",
    link === null
      ? 'When you are done, reply with just "Done."'
      : `When you are done, reply with "Done." followed by the Markdown link [verification link](${link}) exactly as written.`,
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

export function scenario(cwd: string, link: string | null): Step[] {
  const steps: Step[] = [
    {
      name: "UI がデーモンにつながる",
      until: exists('.app[data-connection="connected"]'),
      timeoutMs: 30_000,
    },
    {
      name: "新しいセッションの画面が開く",
      act: 'location.hash = "#/new";',
      until: exists("form.new"),
      timeoutMs: 5_000,
    },
    {
      name: "作業ディレクトリと指示を入れると「Start」が押せる",
      act: `${fill("form.new [name=cwd]", cwd)}\n${fill("form.new [name=prompt]", prompt(link))}`,
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
    { name: "ターンの終わりが画面に出る", until: exists(".entry.turn"), timeoutMs: 120_000, snapshot: "turn-end.png" },
  ];
  if (link === null) return steps;
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
export function judge(observed: Observed, proofFile: string | null): string[] {
  const problems: string[] = [];
  if (!observed.tools.some((tool) => tool.name === "Write" && tool.status === "done")) {
    problems.push(`画面に完了した Write が無い（ツール: ${JSON.stringify(observed.tools)}）`);
  }
  if (!observed.assistant.some((text) => text !== "")) problems.push("画面に claude の返事が無い");
  if (observed.turn === null) problems.push("画面にターンの終わりが無い");
  else if (observed.turn.isError) problems.push(`ターンがエラーで終わった: ${observed.turn.text}`);
  if (observed.alerts.length > 0) problems.push(`画面にエラーが出ている: ${observed.alerts.join(" / ")}`);
  if (proofFile === null) problems.push(`承認した Write の結果の ${PROOF_FILE} が作業ディレクトリに無い`);
  else if (proofFile.trim() !== PROOF_TEXT) {
    problems.push(`${PROOF_FILE} の中身が「${PROOF_TEXT}」でない: ${JSON.stringify(proofFile)}`);
  }
  return problems;
}
