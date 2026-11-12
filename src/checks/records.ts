// ボードの記録の検査。決まりの中身は devboard の lint.ts にあり、ここはリポジトリの姿から入力を組み立てるだけ。

import { lintBoard, type BoardFile } from "@nagaya/devboard/src/lint.ts";
import type { Problem, Repo, Tree } from "../repo.ts";

const isTaskFile = (path: string) => /^dev\/tasks\/[^/]+\.json$/.test(path);
const isDecisionFile = (path: string) => /^docs\/decisions\/[^/]+\.md$/.test(path);
const isLessonFile = (path: string) => /^dev\/lessons\/[^/]+\.json$/.test(path);

function boardFiles(tree: Tree, match: (path: string) => boolean): BoardFile[] {
  return tree.files.filter(match).sort().map((file) => ({ file, text: tree.read(file) ?? "" }));
}

export function checkRecords(repo: Repo): Problem[] {
  const project = repo.read("dev/project.json");
  return lintBoard({
    project: project === null ? null : { file: "dev/project.json", text: project },
    tasks: boardFiles(repo, isTaskFile),
    decisions: boardFiles(repo, isDecisionFile),
    lessons: boardFiles(repo, isLessonFile),
    baseTaskFiles: repo.base?.files.filter(isTaskFile) ?? [],
  });
}
