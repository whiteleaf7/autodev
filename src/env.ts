// git はフックに GIT_DIR や GIT_INDEX_FILE を渡す。linked worktree では絶対パスになるので、
// そのまま子プロセスに渡すと、一時ディレクトリで git を使うテストが本物のリポジトリを操作してしまう。
export function withoutGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("GIT_")));
}
