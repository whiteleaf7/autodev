import { test } from "node:test";
import assert from "node:assert/strict";
import { roborevNotices } from "../src/roborev.ts";

const report = (...checks: object[]) => JSON.stringify({ version: "v0.75.0", checks, summary: {} });
const ok = { id: "daemon.running", category: "daemon", status: "ok", summary: "daemon is running" };

test("roborev doctor に問題が無ければ、何も知らせない", () => {
  assert.deepEqual(roborevNotices(report(ok, { id: "x.info", status: "info", summary: "note" })), []);
});

test("承知のうえで残している警告は知らせない", () => {
  assert.deepEqual(
    roborevNotices(report(ok, { id: "repo.guidelines", status: "warn", summary: "no review guidelines" })),
    [],
  );
});

test("フックが古くなったら、roborev init を使わずに直す手順へ案内する", () => {
  const notices = roborevNotices(
    report(ok, { id: "repo.hooks", status: "warn", summary: "git hooks need attention", fix: "roborev init" }),
  );
  assert.equal(notices.length, 1);
  assert.match(notices[0]!, /repo\.hooks/);
  assert.match(notices[0]!, /docs\/harness\.md/);
  assert.match(notices[0]!, /roborev init や roborev hook install で直さない/);
});

test("ほかの警告や失敗は、roborev の直し方を添えて知らせる", () => {
  const notices = roborevNotices(
    report(
      { id: "jobs.failed", status: "fail", summary: "3 failed jobs", fix: "roborev job list" },
      { id: "daemon.running", status: "warn", summary: "daemon is not reachable" },
    ),
  );
  assert.deepEqual(notices, [
    "roborev doctor（jobs.failed, fail）: 3 failed jobs。直し方: roborev job list",
    "roborev doctor（daemon.running, warn）: daemon is not reachable",
  ]);
});

test("出力が読めなければ、そのことを知らせる", () => {
  assert.match(roborevNotices("panic: boom")[0]!, /JSON ではない/);
  assert.match(roborevNotices(JSON.stringify({ results: [] }))[0]!, /形が変わった/);
});
