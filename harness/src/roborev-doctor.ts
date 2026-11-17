// Claude Code のセッションの始めに呼ばれる（.claude/settings.json の SessionStart フック）。
// roborev の設定やフックに直すべきことがあれば、標準出力に書いて AI のコンテキストに入れる。何も無ければ黙る。

import { projectRoot } from "./project-root.ts";
import { spawnSync } from "node:child_process";
import { roborevNotices } from "./roborev.ts";

const ROOT = projectRoot();

const doctor = spawnSync("roborev", ["doctor", "--json"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 15_000,
  env: { ...process.env, ROBOREV_TELEMETRY_ENABLED: "0" },
});

// roborev が入っていない環境では、知らせることが無い
if (doctor.error && "code" in doctor.error && doctor.error.code === "ENOENT") process.exit(0);

const notices = doctor.error
  ? [`roborev doctor を実行できなかった: ${doctor.error.message}`]
  : roborevNotices(doctor.stdout);
if (notices.length) {
  console.log("roborev の注意（直してから、または直すタスクを登録してから、依頼の作業に入る）:");
  for (const notice of notices) console.log(`- ${notice}`);
}
