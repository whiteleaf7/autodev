import { test } from "node:test";
import assert from "node:assert/strict";
import { blockReason, verificationRequests } from "../src/stop-requests.ts";

const blocks = (reply: string) => verificationRequests(reply).length > 0;

test("ユーザーに動作の確認を頼む返答を見つける（見逃しの例）", () => {
  for (const reply of [
    "実装しました。動作確認をお願いします。",
    "ダッシュボードを開いて、試してみてください！",
    "画面で表示が崩れていないか、ご確認ください。",
    "直したので、もう一度動かしてみてもらえますか？",
    "お手数ですが、確認していただけると助かります。",
    "pnpm board で確かめてほしいです。",
    "変更点は以上です。ご確認のほど、よろしくお願いします。",
    "お手すきのときに試してもらえませんか？",
    "念のため、実機で確認してもらえないでしょうか。",
    "I've fixed the layout. Please verify it in the browser.",
    "Could you try running it again?",
    "Let me know if it works.",
  ])
    assert.ok(blocks(reply), reply);
});

test("AI に物理的にできないことの依頼は通す", () => {
  for (const reply of [
    "GitHub にログインしてから、もう一度試してください。",
    "システム設定で画面収録を許可してから、確認をお願いします。",
    "支払いの設定を確認してください。",
    "外部への公開は、内容を確認してからお願いします。",
    "Please sign in to the Apple Developer account and confirm the team.",
  ])
    assert.ok(!blocks(reply), reply);
});

test("頼んでいない文は通す（誤検出の例）", () => {
  for (const reply of [
    "pnpm test で確認しました。すべて通っています。",
    "撮った画像で表示を確認したので、ご安心ください。",
    "必要なら、確認させてください。",
    "ユーザーに確認してもらう必要はない。",
    "ユーザーに確認してほしいと頼まない。",
    "「動作確認をお願いします」と頼む返答を、Stop フックで差し戻す。",
    "差し戻す文の例は `試してみてください` など。",
    "> 動作確認をお願いします\n\nという返答を止めるようにした。",
    "```\n確認してください\n```\nのような出力は出なくなった。",
    "詳しくは docs/verification.md を見てください。",
    "ダッシュボードは https://mac.example.ts.net:5173/ で開いてください。",
    "I checked it with the screenshot and it works.",
  ])
    assert.ok(!blocks(reply), reply);
});

test("頼んでいる文だけを返す", () => {
  assert.deepEqual(verificationRequests("テストは通りました。\nブラウザで動作確認をお願いします。"), [
    "ブラウザで動作確認をお願いします。",
  ]);
});

test("差し戻しの理由に、頼んだ文と自分で確かめる手段を書く", () => {
  const reason = blockReason(["動作確認をお願いします。"]);
  assert.match(reason, /- 動作確認をお願いします。/);
  assert.match(reason, /docs\/verification\.md/);
  assert.match(reason, /ログイン/);
});
