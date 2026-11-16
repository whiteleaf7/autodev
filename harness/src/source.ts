// コードを、コメント・文字列・それ以外に分ける。構文木を使わずに、正規表現で検査するための下ごしらえ。
// どの結果も元のテキストと同じ長さで、位置（行と桁）がそのまま使える。

export type Scanned = {
  // コメントと、文字列・正規表現の中身を空白にしたもの
  code: string;
  // コメントと正規表現の中身だけを空白にしたもの（文字列の値を読みたい検査用）
  withStrings: string;
  // コメント以外を空白にしたもの
  comments: string;
};

// 「/」が割り算ではなく正規表現の始まりになる位置か
const REGEX_CAN_START = /(^|[(,=:[!&|?{};+\-*%<>~^]|\b(return|typeof|case|in|of|delete|void|throw|new|else|do))\s*$/;

export function scan(text: string): Scanned {
  const code = text.split("");
  const withStrings = text.split("");
  const comments: string[] = text.split("").map((c) => (c === "\n" ? c : " "));
  const blank = (target: string[], i: number) => {
    if (target[i] !== "\n") target[i] = " ";
  };
  const comment = (i: number) => {
    comments[i] = text[i]!;
    blank(code, i);
    blank(withStrings, i);
  };

  // テンプレートリテラルの ${ } の中はコードなので、入れ子を積んで追う
  const stack: ({ template: true } | { template: false; depth: number })[] = [{ template: false, depth: 0 }];
  let i = 0;
  while (i < text.length) {
    const frame = stack[stack.length - 1]!;
    const c = text[i]!;
    const next = text[i + 1];

    if (frame.template) {
      if (c === "`") stack.pop();
      else if (c === "$" && next === "{") {
        stack.push({ template: false, depth: 0 });
        i++;
      } else {
        blank(code, i);
        if (c === "\\") blank(code, ++i);
      }
      i++;
      continue;
    }

    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") comment(i++);
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      while (i < stop) comment(i++);
    } else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") {
        blank(code, i);
        if (text[i] === "\\") blank(code, ++i);
        i++;
      }
      i++;
    } else if (c === "`") {
      stack.push({ template: true });
      i++;
    } else if (c === "/" && REGEX_CAN_START.test(text.slice(Math.max(0, i - 24), i))) {
      const end = regexEnd(text, i);
      if (end < 0) i++;
      else {
        for (let j = i + 1; j < end; j++) {
          blank(code, j);
          blank(withStrings, j);
        }
        i = end + 1;
      }
    } else {
      if (c === "{") frame.depth++;
      else if (c === "}") {
        if (frame.depth === 0 && stack.length > 1) stack.pop();
        else frame.depth--;
      }
      i++;
    }
  }
  return { code: code.join(""), withStrings: withStrings.join(""), comments: comments.join("") };
}

// start にある「/」から始まる正規表現リテラルの、閉じる「/」の位置。同じ行で閉じなければ -1
function regexEnd(text: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") return -1;
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i;
  }
  return -1;
}

export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

// open にある開き括弧に対応する、閉じ括弧の位置。code は scan().code を渡す
export function matchingClose(code: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const opener = code[open]!;
  const closer = pairs[opener];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === opener) depth++;
    else if (code[i] === closer && --depth === 0) return i;
  }
  return -1;
}
