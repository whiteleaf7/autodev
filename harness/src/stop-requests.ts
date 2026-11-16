// AI の最後の返答から、AI が自分で確かめられることをユーザーに確かめさせている文を探す。
// 返答の文字列だけで判断し、ファイルやプロセスには触らない（呼び出し側は stop-hook.ts）。

// 「くれた」「いただきました」「もらえて」のように済んだことを述べる形は、頼みではなく報告（「作業者が確かめてくれた」）。「くれたら」は頼んでいる
const DONE = String.raw`(?!い?た(?!ら)|い?て|[きけ]?まし|けた(?!ら))`;

// 確かめる動詞のあとに、頼む言い方が続くもの（「ご確認のほど」はそれだけで頼んでいる）。「確認させてください」（AI が確かめる許しを求める）は当たらない
const JA_REQUEST = new RegExp(
  String.raw`(?:確認(?:を|して|してみて)?|確かめて(?:みて)?|試して(?:みて)?|動かして(?:みて)?|使って(?:みて)?|触って(?:みて)?|チェック(?:を|して)?|テスト(?:を|して)?|検証(?:を|して)?)(?:ください|下さい|お願い|(?:いただ|頂|もらえ|くれ)${DONE}|もらいたい|ほしい|欲しい)|確認の?ほど`,
);
const EN_REQUEST =
  /\b(?:please|could you|can you|would you|kindly)\s+(?:\w+\s+){0,2}?(?:verify|check|test|try|confirm|run)\b|\blet me know (?:if|whether|how) (?:it|this|that) (?:works|goes)\b/i;

// 打ち消しが続くものは頼んでいない（「確認してもらう必要はない」）
const NEGATED = /(?:必要は?(?:ない|無い|ありません)|ません(?:でした)?$|ない(?:よう|ように|で)?$)/;

// AI には物理的にできないこと。これを含む文の依頼は通す（CLAUDE.md の「判断と確認は AI が行う」の例外）
const BEYOND_AI =
  /ログイン|ログアウト|サインイン|認証|パスワード|二段階|支払|課金|購入|契約|権限|許可|公開|リリース|\b(?:log ?in|sign ?in|password|2fa|payment|billing|permission|publish|release)\b/i;

// 引用（「」や『』、コード、> の行）の中は、頼みではなく言及として扱う。
// 差し戻しの文には元の文をそのまま引くため、消さずに同じ長さの記号で塗りつぶして位置を保つ
function maskQuotes(text: string): string {
  return text.replace(/```[\s\S]*?```|`[^`\n]*`|「[^「」]*」|『[^『』]*』|^\s*>.*$/gm, (quote) =>
    quote.replace(/[^\n]/g, "_"),
  );
}

function sentenceSpans(text: string): Array<{ start: number; end: number }> {
  const spans = [];
  let start = 0;
  for (const boundary of text.matchAll(/(?<=[。！？!?])|\n|(?<=\.)\s+/g)) {
    spans.push({ start, end: boundary.index });
    start = boundary.index + boundary[0].length;
  }
  spans.push({ start, end: text.length });
  return spans;
}

function asksToVerify(sentence: string): boolean {
  const request = JA_REQUEST.exec(sentence) ?? EN_REQUEST.exec(sentence);
  if (!request) return false;
  const rest = sentence.slice(request.index + request[0].length).replace(/[。！？!?.\s]+$/, "");
  return !NEGATED.test(rest);
}

export function verificationRequests(reply: string): string[] {
  const masked = maskQuotes(reply);
  return sentenceSpans(masked)
    .filter(({ start, end }) => {
      const sentence = masked.slice(start, end);
      return asksToVerify(sentence) && !BEYOND_AI.test(sentence);
    })
    .map(({ start, end }) => reply.slice(start, end).trim());
}

export function blockReason(requests: string[]): string {
  return [
    "返答で、AI が自分で確かめられることをユーザーに確かめさせている:",
    ...requests.map((request) => `- ${request}`),
    "docs/verification.md の手段（テスト、画面の撮影、ウィンドウの一覧、起動して出力や応答を見る）で自分で動かして確かめ、確かめた結果を返答に書き直す。",
    "ユーザーに頼んでよいのは、ログイン・支払い・OS の権限の許可・外部への公開のように AI に物理的にできないことだけ。",
  ].join("\n");
}
