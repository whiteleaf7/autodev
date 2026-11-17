// ゲートの lint・型チェック・テストを回すための道具。出力をためて並列に動かす、段ごとの所要時間を出す

import { spawn } from "node:child_process";

export type Stage = { name: string; ms: number };

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

// 段ごとの所要時間。lint と型チェックを並列に回すときは、並列にしたものを 1 つの段として数える
export function formatTimings(stages: Stage[]): string {
  const total = stages.reduce((sum, stage) => sum + stage.ms, 0);
  return `check: 所要時間 ${stages.map((stage) => `${stage.name} ${seconds(stage.ms)}`).join("・")}（合計 ${seconds(total)}）`;
}

export type Buffered = { status: number; output: string };

// 標準出力と標準エラーを、届いた順に 1 つにためる。並列に動かしたものを、あとで順に表示するために使う
export function runBuffered(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<Buffered> {
  return new Promise((done) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => done({ status: 1, output: `${output}${command} を起動できない: ${error.message}\n` }));
    child.on("close", (code) => done({ status: code ?? 1, output }));
  });
}

// 出力をそのまま端末に流しながら動かす（テストのように、長く動いて、進み具合を見たいもの）
export function runInherited(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<number> {
  return new Promise((done) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", () => done(1));
    child.on("close", (code) => done(code ?? 1));
  });
}
