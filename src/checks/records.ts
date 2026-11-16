// リポジトリにある記録（決定記録）の検査。形式は devboard の create_decision が書くものと同じ（~/github/devboard の src/lint.ts）。
// devboard が無い CI でも動かすため、決まりはここにも持つ。形式を変えるときは両方を直す。
// タスク・教訓・マイルストーンは git の外の SQLite にあり、書く時点で devboard が検証する

import type { Problem, Repo } from "../repo.ts";

const DECISION_STATUSES = ["提案", "採用", "却下", "置き換え"] as const;

const isDecisionFile = (path: string) => /^docs\/decisions\/[^/]+\.md$/.test(path);

type DecisionFile = { file: string; text: string };

export function lintDecisions(decisions: DecisionFile[]): Problem[] {
  const problems: Problem[] = [];
  const numbers = new Map<string, string>();
  for (const { file, text } of decisions) {
    const add = (message: string) => problems.push({ check: "invalid-decision", file, message });
    const name = file.split("/").pop() ?? file;
    const number = /^(\d{4})-[a-z0-9]+(-[a-z0-9]+)*\.md$/.exec(name)?.[1];
    if (!number) {
      add("ファイル名は NNNN-slug.md（英小文字・数字・ハイフン）にする");
      continue;
    }
    const other = numbers.get(number);
    if (other) add(`番号 ${number} が ${other} と重複している`);
    else numbers.set(number, file);

    const heading = /^#\s*(\d{4})\.\s*\S/m.exec(text)?.[1];
    if (!heading) add("先頭に「# NNNN. タイトル」の見出しが無い");
    else if (heading !== number) add(`見出しの番号（${heading}）がファイル名（${number}）と合わない`);

    const status = /^-\s*状態:\s*(.*)$/m.exec(text)?.[1]?.trim();
    if (status === undefined) add("「- 状態:」の行が無い");
    else if (!(DECISION_STATUSES as readonly string[]).includes(status))
      add(`状態「${status}」は使えない（${DECISION_STATUSES.join("・")}）`);
    if (!/^-\s*日付:\s*\d{4}-\d{2}-\d{2}\s*$/m.test(text)) add("「- 日付: YYYY-MM-DD」の行が無い");
    for (const section of ["背景", "決定", "影響"]) {
      if (!new RegExp(`^##\\s*${section}\\s*$`, "m").test(text)) add(`「## ${section}」の見出しが無い`);
    }
  }
  return problems;
}

export function checkRecords(repo: Repo): Problem[] {
  return lintDecisions(
    repo.files
      .filter(isDecisionFile)
      .sort()
      .map((file) => ({ file, text: repo.read(file) ?? "" })),
  );
}
