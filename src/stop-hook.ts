// エージェント（Claude Code や Codex など）が返答を終えるときに呼ばれる（.claude/settings.json / .codex/hooks.json の Stop フック）。
// 最後の返答が、AI が自分で確かめられることをユーザーに確かめさせていれば差し戻す。

import { readFileSync } from "node:fs";
import { z } from "zod";
import { blockReason, verificationRequests } from "./stop-requests.ts";

const StopInput = z.object({
  stop_hook_active: z.boolean().optional(),
  last_assistant_message: z.string().optional(),
});

const raw = readFileSync(0, "utf8").trim();
if (!raw) process.exit(0);
const input = StopInput.safeParse(JSON.parse(raw));
if (!input.success) {
  console.error(
    `Stop フックの入力の形が変わった。tools/harness/src/stop-hook.ts の StopInput を合わせる: ${input.error.message}`,
  );
  process.exit(1);
}
// 一度差し戻したあとの返答は通す。差し戻しが続いて止まらなくなるのを防ぐ
if (input.data.stop_hook_active || !input.data.last_assistant_message) process.exit(0);

const requests = verificationRequests(input.data.last_assistant_message);
if (requests.length) console.log(JSON.stringify({ decision: "block", reason: blockReason(requests) }));
