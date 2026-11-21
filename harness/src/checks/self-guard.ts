// 変更が、自分を判定する仕組み（CI・git のフック・評価を隠す設定）を、同じ変更で外していないかを、基点と比べて見る（T-268）。
// 中身の正しさは問わず、基点にあった守りが消えたことだけを見る。守りを足す・強める変更は止めない

import { parseJson, type Problem, type Repo, type Tree } from "../repo.ts";
import { loosenedSettings, parseWorkflowConfig, WORKFLOW_CONFIG_FILE } from "../workflow-config.ts";

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
// ゲートを回す行（`run: pnpm check`、複数行の run の中の `pnpm -s check` など）
const GATE_RUN = /\b(pnpm|autodev)\s+(-\S+\s+)*(run\s+)?check\b/;
const CONTINUE_ON_ERROR = /^\s*-?\s*continue-on-error:\s*true\b/;
const HOOK = /^\.githooks\/[^/]+$/;
const HOOK_CALL = /\bautodev\s+hook\s+[\w-]+/;
const DEVBOARD_CONFIG = ".devboard.json";

const codeLines = (text: string | null) =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

function workflows(repo: Repo, base: Tree): Problem[] {
  return base.files
    .filter((file) => WORKFLOW.test(file))
    .flatMap((file) => {
      const before = codeLines(base.read(file));
      const now = codeLines(repo.read(file));
      const add = (message: string): Problem => ({ check: "loosened-ci", file, message });
      const lost = before.filter((line) => GATE_RUN.test(line) && !now.includes(line));
      const problems = lost.map((line) =>
        add(`CI からゲートを回す行（${line}）が消えている。CI の検査は、取り込む変更自身では外さない`),
      );
      const allowed = (lines: string[]) => lines.filter((line) => CONTINUE_ON_ERROR.test(line)).length;
      if (allowed(now) > allowed(before))
        problems.push(add("continue-on-error: true を足して、失敗しても CI を通す形にしている"));
      return problems;
    });
}

function hooks(repo: Repo, base: Tree): Problem[] {
  return base.files
    .filter((file) => HOOK.test(file))
    .flatMap((file) => {
      const calls = codeLines(base.read(file)).flatMap((line) => line.match(HOOK_CALL) ?? []);
      const now = codeLines(repo.read(file)).join("\n");
      return calls
        .filter((call) => !now.includes(call))
        .map((call) => ({
          check: "neutered-hook",
          file,
          message: `フックから ${call} の呼び出しが消えている（コミットのたびのゲートが回らなくなる）`,
        }));
    });
}

function hiddenPathsOf(tree: Tree): string[] {
  const json = parseJson(tree.read(DEVBOARD_CONFIG));
  const paths = typeof json === "object" && json !== null ? (json as Record<string, unknown>).hiddenPaths : null;
  return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : [];
}

function hiddenPaths(repo: Repo, base: Tree): Problem[] {
  const now = hiddenPathsOf(repo);
  return hiddenPathsOf(base)
    .filter((path) => !now.includes(path))
    .map((path) => ({
      check: "unhidden-path",
      file: DEVBOARD_CONFIG,
      message: `hiddenPaths から ${path} を外している（隠していた最終評価のシナリオなどが、recall で読めるようになる）`,
    }));
}

const LOOSENED_WORKFLOW_MESSAGES = {
  commitRunsSlowChecks: "commitRunsSlowChecks を false にしている（コミットのゲートが lint・型チェック・テストを回さなくなる）",
  landWaitsForCi: "landWaitsForCi を false にしている（land が CI を待たずに main へマージする）",
} as const;

function workflowSettings(repo: Repo, base: Tree): Problem[] {
  const now = parseWorkflowConfig(repo.read(WORKFLOW_CONFIG_FILE));
  const before = parseWorkflowConfig(base.read(WORKFLOW_CONFIG_FILE)).config;
  const broken: Problem[] = now.error
    ? [
        {
          check: "broken-workflow-config",
          file: WORKFLOW_CONFIG_FILE,
          message: `設定が崩れているので、既定（いちばん慎重な流れ）で動く: ${now.error}`,
        },
      ]
    : [];
  return [
    ...broken,
    ...loosenedSettings(before, now.config).map((setting) => ({
      check: "loosened-workflow",
      file: WORKFLOW_CONFIG_FILE,
      message: LOOSENED_WORKFLOW_MESSAGES[setting],
    })),
  ];
}

export function checkSelfGuards(repo: Repo): Problem[] {
  const base = repo.base;
  if (!base) return [];
  return [...workflows(repo, base), ...hooks(repo, base), ...hiddenPaths(repo, base), ...workflowSettings(repo, base)];
}
