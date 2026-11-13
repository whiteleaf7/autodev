// `roborev doctor --json` の出力から、AI に知らせることを選ぶ。roborev には触らず、渡された出力だけで判断する。

import { z } from "zod";

const DoctorReport = z.object({
  checks: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      summary: z.string(),
      fix: z.string().optional(),
    }),
  ),
});

const QUIET_STATUSES = new Set(["ok", "info"]);

// 承知のうえで残している警告。REVIEW.md を書くかは T-048 で決める
const ACCEPTED = new Set(["repo.guidelines"]);

const HOOKS_ADVICE =
  "roborev が更新されて、フックの版が上がった可能性がある。docs/harness.md の「roborev のフックを新しい版に合わせる」の手順で .githooks/ を直す。" +
  "roborev init や roborev hook install で直さない（roborev の処理が先頭に差し込まれ、ハーネスの評価でレビューを止める条件が効かなくなる）";

export function roborevNotices(doctorOutput: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(doctorOutput);
  } catch {
    return [
      `roborev doctor --json の出力が JSON ではない。roborev doctor を手で実行して確かめる: ${doctorOutput.trim().slice(0, 200)}`,
    ];
  }
  const report = DoctorReport.safeParse(json);
  if (!report.success)
    return ["roborev doctor --json の出力の形が変わった。tools/harness/src/roborev.ts の DoctorReport を合わせる"];

  return report.data.checks
    .filter((check) => !QUIET_STATUSES.has(check.status) && !ACCEPTED.has(check.id))
    .map((check) => {
      const finding = `roborev doctor（${check.id}, ${check.status}）: ${check.summary}`;
      if (check.id === "repo.hooks") return `${finding}。${HOOKS_ADVICE}`;
      return check.fix ? `${finding}。直し方: ${check.fix}` : finding;
    });
}
