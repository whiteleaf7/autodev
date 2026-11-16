import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { COMMON_RULES_FILE, checkRules, staleAgainstBase } from "../src/checks/rules.ts";
import { memoryRepo } from "../src/repo.ts";
import { findRegion, renderRegion, replaceRegion } from "../src/rules-region.ts";
import { syncRules } from "../src/rules-sync.ts";

const common = "## 進め方\n\n- 共通のルール\n";
const withRegion = (body: string) => `# 製品\n\n固有の説明\n\n${renderRegion(body)}\n\n## 固有のルール\n\n- 固有\n`;

test("区画を作り、中身を取り出し、区画の外を変えずに差し替える", () => {
  const doc = withRegion(common);
  assert.equal(findRegion(doc)?.body, common.trimEnd());
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

test("AGENTS.md の区画が common.md と同じなら通し、ずれたら直し方を添えて止める", () => {
  const files = { "AGENTS.md": withRegion(common), [COMMON_RULES_FILE]: common };
  assert.deepEqual(checkRules(memoryRepo(files)), []);
  const stale = checkRules(memoryRepo({ ...files, [COMMON_RULES_FILE]: `${common}- 足した\n` }));
  assert.deepEqual(
    stale.map((p) => p.check),
    ["stale-common-rules"],
  );
  assert.match(stale[0]?.message ?? "", /rules-sync/);
  assert.ok(stale[0]?.line, "区画の行を指す");
});

test("区画が無いリポジトリは見ない。区画があって common.md が無い・区画が壊れていれば止める", () => {
  assert.deepEqual(checkRules(memoryRepo({ "AGENTS.md": "# 区画なし\n" })), []);
  assert.deepEqual(checkRules(memoryRepo({})), []);
  assert.equal(checkRules(memoryRepo({ "AGENTS.md": withRegion(common) })).length, 1);
  const broken = "<!-- autodev:common:start -->\n本文\n";
  assert.equal(checkRules(memoryRepo({ "AGENTS.md": broken, [COMMON_RULES_FILE]: common })).length, 1);
});

test("base/ の共通の規約と違うときだけ、案内を返す", () => {
  assert.equal(staleAgainstBase(common, `${common}\n`), null);
  assert.equal(staleAgainstBase(null, common), null);
  assert.equal(staleAgainstBase(common, null), null);
  assert.match(staleAgainstBase(common, `${common}- base だけにある\n`) ?? "", /rules-sync/);
});

test("syncRules は、--from で common.md を差し替えてから、区画を作り直す", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "autodev-rules-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tools/harness/rules"), { recursive: true });
  writeFileSync(join(root, COMMON_RULES_FILE), common);
  writeFileSync(join(root, "AGENTS.md"), withRegion(common));
  const newer = join(root, "newer-common.md");
  writeFileSync(newer, "## 進め方\n\n- 新しい共通のルール\n");

  syncRules(root, newer);
  assert.equal(readFileSync(join(root, COMMON_RULES_FILE), "utf8"), "## 進め方\n\n- 新しい共通のルール\n");
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("新しい共通のルール") && agents.includes("固有の説明") && agents.includes("- 固有"));
  assert.deepEqual(
    checkRules(memoryRepo({ "AGENTS.md": agents, [COMMON_RULES_FILE]: "## 進め方\n\n- 新しい共通のルール\n" })),
    [],
  );

  writeFileSync(join(root, "AGENTS.md"), "# 区画なし\n");
  assert.throws(() => syncRules(root), /区画が無い/);
});
