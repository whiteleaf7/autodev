# autodev

複数のプロジェクトが共有する、AI 自律開発の実行基盤（ゲート・フック・取り込み・評価・検証）。使い方は `README.md`。

- パッケージマネージャは pnpm。npm / npx は使わない
- Node の TypeScript 直接実行を使う。import には `.ts` 拡張子を付け、enum や namespace など型の除去だけで消えない構文は使わない（`erasableSyntaxOnly`）
- コミットメッセージは Conventional Commits の簡潔な英語
- このコマンドは、使っているすべてのプロジェクトに同時に効く。検査の意味を緩める変更（テストを減らす、検査項目を外す）はしない
- 対象のプロジェクトは、コマンドを打った場所（cwd）から決める（`harness/src/project-root.ts`）。autodev 自身の置き場所に依存するコードを書かない
- プロジェクトのデータ（評価のシナリオ、設定）をここに置かない。最終評価用のシナリオ（heldout）は、ここにも、履歴にも入れない（リポジトリは公開する）
- コマンド（`src/commands.ts`）を足したら、README の表も直す
