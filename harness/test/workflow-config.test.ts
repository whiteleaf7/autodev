import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKFLOW, loosenedSettings, parseWorkflowConfig } from "../src/workflow-config.ts";

test("設定が無ければ、いちばん慎重な流れ（コミットで全部回す・CI を待つ）にする", () => {
  assert.deepEqual(parseWorkflowConfig(null), {
    config: { commitRunsSlowChecks: true, landWaitsForCi: true },
    error: null,
  });
});

test("書いた項目だけを変え、書かなかった項目は慎重な既定のままにする", () => {
  assert.deepEqual(parseWorkflowConfig('{"landWaitsForCi": false}').config, {
    commitRunsSlowChecks: true,
    landWaitsForCi: false,
  });
});

test("崩れた設定は、理由を返して既定で動く（緩まない）", () => {
  for (const text of ["{", '{"landWaitsForCi": "no"}', '{"waitForCi": false}']) {
    const parsed = parseWorkflowConfig(text);
    assert.deepEqual(parsed.config, DEFAULT_WORKFLOW, text);
    assert.ok(parsed.error, text);
  }
});

test("基点で慎重だった項目を緩めたものだけを返し、強める・そのままは返さない", () => {
  const loose = { commitRunsSlowChecks: false, landWaitsForCi: false };
  assert.deepEqual(loosenedSettings(DEFAULT_WORKFLOW, loose), ["commitRunsSlowChecks", "landWaitsForCi"]);
  assert.deepEqual(loosenedSettings(loose, DEFAULT_WORKFLOW), []);
  assert.deepEqual(loosenedSettings(loose, loose), []);
});
