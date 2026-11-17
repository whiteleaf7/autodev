// 速い検査の記録（gate-log.ts）を、mode と検査ごとの件数と例にまとめて出す。
//   autodev gate-log                 すべての検査。例は検査ごとに 3 件まで
//   autodev gate-log --check <名前>  1 つの検査の、すべての指摘

import { parseArgs } from "node:util";
import { projectRoot } from "./project-root.ts";
import { gateLogFile, readGateLog, summarizeGateLog } from "./gate-log.ts";

const { values } = parseArgs({ options: { check: { type: "string" } } });
const file = gateLogFile(projectRoot());
if (!file) {
  console.error("gate-log: git の共通のディレクトリが分からない。プロジェクトの git の作業ツリーで実行する");
  process.exit(1);
}
const entries = readGateLog(file).filter((entry) => values.check === undefined || entry.check === values.check);
console.log(summarizeGateLog(entries, values.check === undefined ? 3 : Number.POSITIVE_INFINITY));
