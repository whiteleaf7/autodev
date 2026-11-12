// シナリオごとの結果を点数にまとめる。点数の定義は eval/SPEC.md。

import { FAMILIES, type Family, type Scenario } from "./scenario.ts";

export type Outcome = "caught" | "missed" | "passed" | "false-alarm" | "hit" | "no-hit" | "inapplicable";

export type Result = { scenario: Scenario; outcome: Outcome; detail: string };

const FALSE_ALARM_PENALTY = 2;

export type FamilySummary = {
  bad: number;
  caught: number;
  good: number;
  falseAlarms: number;
  queries: number;
  hits: number;
  inapplicable: number;
  points: number;
};

export type Summary = { score: number; max: number; families: Record<Family, FamilySummary> };

export function summarize(results: Result[]): Summary {
  const families = Object.fromEntries(
    FAMILIES.map((family) => {
      const own = results.filter((r) => r.scenario.family === family);
      const count = (outcome: Outcome) => own.filter((r) => r.outcome === outcome).length;
      const kind = (k: Scenario["kind"]) => own.filter((r) => r.scenario.kind === k).length;
      const summary: FamilySummary = {
        bad: kind("bad"),
        caught: count("caught"),
        good: kind("good"),
        falseAlarms: count("false-alarm"),
        queries: kind("query"),
        hits: count("hit"),
        inapplicable: count("inapplicable"),
        points: count("caught") + count("hit") - FALSE_ALARM_PENALTY * count("false-alarm"),
      };
      return [family, summary];
    }),
  ) as Record<Family, FamilySummary>;
  const all = Object.values(families);
  return {
    score: all.reduce((sum, f) => sum + f.points, 0),
    max: all.reduce((sum, f) => sum + f.bad + f.queries, 0),
    families,
  };
}

export function formatSummary(summary: Summary): string {
  const rows = FAMILIES.map((family) => {
    const f = summary.families[family];
    const cells = [
      family.padEnd(15),
      f.bad ? `止めた ${f.caught}/${f.bad}` : "",
      f.good ? `誤検出 ${f.falseAlarms}/${f.good}` : "",
      f.queries ? `引き出せた ${f.hits}/${f.queries}` : "",
      f.inapplicable ? `当てられない ${f.inapplicable}` : "",
      `${f.points} 点`,
    ];
    return cells.filter(Boolean).join("  ");
  });
  return [...rows, `点数 ${summary.score} / ${summary.max}`].join("\n");
}
