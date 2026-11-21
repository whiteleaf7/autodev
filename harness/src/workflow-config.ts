// プロジェクトごとの、ゲートを回す流れの設定（.autodev/workflow.json）。無ければ、いちばん慎重な流れにする。
// 開発者が 1 人の初期開発のように、待ち時間を減らしたいプロジェクトだけが緩める。
// 緩める変更は、ゲートの自分を判定する仕組みの検査（loosened-workflow）が見る

import { z } from "zod";

export const WORKFLOW_CONFIG_FILE = ".autodev/workflow.json";

const WorkflowConfig = z.strictObject({
  // false なら、コミットのゲートは速い検査だけを回し、lint・型チェック・テストは land のゲートに任せる
  commitRunsSlowChecks: z.boolean().default(true),
  // false なら、land は PR の CI を待たずにマージする。CI は main への push で回る
  landWaitsForCi: z.boolean().default(true),
});
export type WorkflowConfig = z.infer<typeof WorkflowConfig>;

const SETTINGS = ["commitRunsSlowChecks", "landWaitsForCi"] as const;
export const DEFAULT_WORKFLOW: WorkflowConfig = WorkflowConfig.parse({});

export type ParsedWorkflow = { config: WorkflowConfig; error: string | null };

// 崩れた設定は、無いものとして扱う（既定より緩むことはない）
export function parseWorkflowConfig(text: string | null): ParsedWorkflow {
  if (text === null) return { config: DEFAULT_WORKFLOW, error: null };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return {
      config: DEFAULT_WORKFLOW,
      error: `JSON として読めない（${e instanceof Error ? e.message : String(e)}）`,
    };
  }
  const parsed = WorkflowConfig.safeParse(json);
  if (!parsed.success) return { config: DEFAULT_WORKFLOW, error: z.prettifyError(parsed.error) };
  return { config: parsed.data, error: null };
}

// 基点では慎重だったのに、いまは緩めている項目
export const loosenedSettings = (before: WorkflowConfig, now: WorkflowConfig) =>
  SETTINGS.filter((setting) => before[setting] && !now[setting]);
