import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkRules, readCommonRules, staleAgainstCommon } from "../src/checks/rules.ts";
import { memoryRepo } from "../src/repo.ts";
import { commonSha, findRegion, renderRegion, replaceRegion } from "../src/rules-region.ts";
import { syncRules } from "../src/rules-sync.ts";

const common = "## 進め方\n\n- 共通のルール\n";
const withRegion = (body: string) => `# 製品\n\n固有の説明\n\n${renderRegion(body)}\n\n## 固有のルール\n\n- 固有\n`;

test("区画を作り、中身とハッシュを取り出し、区画の外を変えずに差し替える", () => {
  const doc = withRegion(common);
  const region = findRegion(doc);
  assert.equal(region?.body, common.trimEnd());
  assert.equal(region?.recordedSha, commonSha(common), "始まりの行に、中身のハッシュを記録する");
  const next = replaceRegion(doc, "## 新しい\n\n- 変わった\n");
  assert.ok(next?.includes("固有の説明") && next.includes("## 固有のルール"), "区画の外はそのまま");
  assert.equal(findRegion(next ?? "")?.body, "## 新しい\n\n- 変わった");
  assert.equal(replaceRegion("# 区画の無い文書\n", common), null);
});

test("始まりだけ・終わりだけ・逆順の区画は、壊れているとして断る", () => {
  const start = renderRegion(common).split("\n")[0]!;
  assert.throws(() => findRegion(`${start}\n本文\n`), /1 組そろっていない/);
  assert.throws(() => findRegion("<!-- autodev:common:end -->\n"), /1 組そろっていない/);
  assert.throws(() => findRegion(`<!-- autodev:common:end -->\n本文\n${start}\n`), /1 組そろっていない/);
});

test("区画の中身が記録したハッシュと合えば通し、直接直されたり、ハッシュが無かったりすれば、直し方を添えて止める", () => {
  assert.deepEqual(checkRules(memoryRepo({ "AGENTS.md": withRegion(common) })), []);
  const edited = withRegion(common).replace("共通のルール", "勝手に直したルール");
  const stale = checkRules(memoryRepo({ "AGENTS.md": edited }));
  assert.deepEqual(stale.map((p) => p.check), ["stale-common-rules"]);
  assert.match(stale[0]?.message ?? "", /autodev rules-sync/);
  assert.ok(stale[0]?.line, "区画の行を指す");
  const noSha = "<!-- autodev:common:start -->\n本文\n<!-- autodev:common:end -->\n";
  assert.equal(checkRules(memoryRepo({ "AGENTS.md": noSha })).length, 1, "ハッシュの無い区画も止める");
});

test("区画が無い・AGENTS.md が無いリポジトリは見ない。区画が壊れていれば止める", () => {
  assert.deepEqual(checkRules(memoryRepo({ "AGENTS.md": "# 区画なし\n" })), []);
  assert.deepEqual(checkRules(memoryRepo({})), []);
  const broken = "<!-- autodev:common:start sha=000000000000 -->\n本文\n";
  assert.equal(checkRules(memoryRepo({ "AGENTS.md": broken })).length, 1);
});

test("autodev の共通の規約の最新と違うときだけ、案内を返す（止めない）", () => {
  const doc = withRegion(common);
  assert.equal(staleAgainstCommon(doc, `${common}\n`), null, "末尾の空行の違いは同じ");
  assert.equal(staleAgainstCommon(null, common), null);
  assert.equal(staleAgainstCommon("# 区画なし\n", common), null);
  assert.match(staleAgainstCommon(doc, `${common}- 新しく足した\n`) ?? "", /autodev rules-sync/);
});

test("syncRules は、autodev の共通の規約で区画を作り直し、区画の外を変えない", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "autodev-rules-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "AGENTS.md"), withRegion("## 古い共通の規約\n\n- 古い\n"));

  syncRules(root);
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.equal(findRegion(agents)?.body, readCommonRules().trimEnd());
  assert.ok(agents.includes("固有の説明") && agents.includes("- 固有"));
  assert.deepEqual(checkRules(memoryRepo({ "AGENTS.md": agents })), []);
  assert.equal(staleAgainstCommon(agents, readCommonRules()), null);

  writeFileSync(join(root, "AGENTS.md"), "# 区画なし\n");
  assert.throws(() => syncRules(root), /区画が無い/);
});
