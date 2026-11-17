// 速い検査の mode。enforce は止める、observe は止めずに記録だけ残す、off は見ない。
// 新しい検査は observe で足し、誤検出が無いのを記録で見てから enforce にする（docs/harness.md の「検査を足すとき」）。
// プロジェクトは .autodev/gate.json で検査ごとに mode を上げ下げできるが、基点より下げる変更はゲートが止める

import { z } from "zod";
import type { Problem, Repo, Tree } from "./repo.ts";

const Mode = z.enum(["off", "observe", "enforce"]);
type Mode = z.infer<typeof Mode>;
type Defaults = Readonly<Record<string, Mode>>;

const GateConfig = z.strictObject({ checks: z.record(z.string(), Mode) });
type Checks = z.infer<typeof GateConfig>["checks"];

export const GATE_CONFIG_FILE = ".autodev/gate.json";

// autodev が既定を enforce 以外にしている検査。新しい検査はここに observe で足し、enforce にするときに消す
export const DEFAULT_MODES: Defaults = {
  // T-268: 変更が、自分を判定する仕組みを外す・コミットのゲートを通らずに入る
  "loosened-since-base": "observe",
  "loosened-ci": "observe",
  "neutered-hook": "observe",
  "unhidden-path": "observe",
};

// 評価（autodev eval）は、observe で始めた検査も止める側で判定する。止める例・通す例のシナリオで、検査の中身を試すため
export const ENFORCE_DEFAULTS_ENV = "AUTODEV_ENFORCE_DEFAULTS";

export const defaultModes = (env: NodeJS.ProcessEnv = process.env): Defaults =>
  env[ENFORCE_DEFAULTS_ENV] ? {} : DEFAULT_MODES;

// mode の設定そのものを守る検査は、設定では変えられない
const FIXED_CHECKS = new Set(["loosened-gate-mode", "broken-gate-config"]);

const RANK: Record<Mode, number> = { off: 0, observe: 1, enforce: 2 };

type Parsed = { checks: Checks; error: string | null };

function parseConfig(text: string | null): Parsed {
  if (text === null) return { checks: {}, error: null };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { checks: {}, error: `JSON として読めない（${e instanceof Error ? e.message : String(e)}）` };
  }
  const parsed = GateConfig.safeParse(json);
  if (!parsed.success) return { checks: {}, error: z.prettifyError(parsed.error) };
  const fixed = Object.keys(parsed.data.checks).filter((check) => FIXED_CHECKS.has(check));
  if (fixed.length)
    return { checks: {}, error: `${fixed.join("・")} の mode は変えられない（mode の設定を守る検査のため）` };
  return { checks: parsed.data.checks, error: null };
}

const configOf = (tree: Tree | null): Parsed => parseConfig(tree?.read(GATE_CONFIG_FILE) ?? null);

const resolve = (defaults: Defaults, checks: Checks, check: string): Mode =>
  FIXED_CHECKS.has(check) ? "enforce" : (checks[check] ?? defaults[check] ?? "enforce");

export type GateModes = { modeOf: (check: string) => Mode; problems: Problem[] };

// いまの姿の設定で mode を決め、設定の崩れと、基点より mode を下げた検査を問題として返す。
// 崩れた設定は無いものとして扱う（既定より緩むことはない）
export function gateModes(repo: Repo, defaults: Defaults = defaultModes()): GateModes {
  const now = configOf(repo);
  const base = configOf(repo.base);
  const problems: Problem[] = [];
  if (now.error) problems.push({ check: "broken-gate-config", file: GATE_CONFIG_FILE, message: now.error });
  const named = new Set([...Object.keys(now.checks), ...Object.keys(base.checks), ...Object.keys(defaults)]);
  for (const check of [...named].toSorted()) {
    const [before, after] = [resolve(defaults, base.checks, check), resolve(defaults, now.checks, check)];
    if (RANK[after] < RANK[before]) {
      problems.push({
        check: "loosened-gate-mode",
        file: GATE_CONFIG_FILE,
        message: `${check} の mode を ${before} から ${after} に下げている。誤検出なら、通すべき例を評価のシナリオに足して検査を直す`,
      });
    }
  }
  return { modeOf: (check) => resolve(defaults, now.checks, check), problems };
}

type Split = { blocking: Problem[]; observed: Problem[] };

export function splitByMode(problems: Problem[], modeOf: (check: string) => Mode): Split {
  const split: Split = { blocking: [], observed: [] };
  for (const problem of problems) {
    const mode = modeOf(problem.check);
    if (mode === "enforce") split.blocking.push(problem);
    else if (mode === "observe") split.observed.push(problem);
  }
  return split;
}
