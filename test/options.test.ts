import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDevToolsActivePort, parseScreenshotArgs, usage } from "../src/options.ts";

test("省略した引数は既定値になり、渡した値は数として読む", () => {
  assert.deepEqual(parseScreenshotArgs(["http://127.0.0.1:4848/", "out.png"]), {
    url: "http://127.0.0.1:4848/",
    out: "out.png",
    waitFor: undefined,
    fill: [],
    click: [],
    waitAfter: undefined,
    width: 1280,
    height: 800,
    mobile: false,
    dark: false,
    reducedMotion: false,
    laterMs: undefined,
    lang: undefined,
    timeoutMs: 15_000,
  });
  assert.deepEqual(
    parseScreenshotArgs([
      "https://example.com/a",
      "dir/shot.png",
      "--width",
      "320",
      "--height",
      "200",
      "--timeout",
      "500",
      "--wait-for",
      "#ready",
      "--click",
      ".card",
      "--click",
      "#edit",
      "--fill",
      "input[name=code]=ABCD-EFGH",
      "--wait-after",
      "#done",
      "--dark",
      "--reduced-motion",
      "--later",
      "1500",
      "--lang",
      "ja",
    ]),
    {
      url: "https://example.com/a",
      out: "dir/shot.png",
      waitFor: "#ready",
      fill: [{ selector: "input[name=code]", value: "ABCD-EFGH" }],
      click: [".card", "#edit"],
      waitAfter: "#done",
      width: 320,
      height: 200,
      mobile: false,
      dark: true,
      reducedMotion: true,
      laterMs: 1500,
      lang: "ja",
      timeoutMs: 500,
    },
  );
});

test("--mobile は、幅と高さを省くとスマホの大きさになり、渡した方はそのまま使う", () => {
  const viewport = (argv: string[]) => {
    const { width, height, mobile } = parseScreenshotArgs(["http://127.0.0.1/", "out.png", ...argv]);
    return { width, height, mobile };
  };
  assert.deepEqual(viewport(["--mobile"]), { width: 390, height: 844, mobile: true });
  assert.deepEqual(viewport(["--mobile", "--width", "412"]), { width: 412, height: 844, mobile: true });
  assert.deepEqual(viewport(["--height", "600", "--mobile"]), { width: 390, height: 600, mobile: true });
  assert.deepEqual(viewport(["--width", "390"]), { width: 390, height: 800, mobile: false });
});

test("足りない・不正な引数は、使い方を添えて断る", () => {
  const rejects = (argv: string[], reason: RegExp) =>
    assert.throws(
      () => parseScreenshotArgs(argv),
      (e: Error) => reason.test(e.message) && e.message.endsWith(usage),
      argv.join(" "),
    );
  rejects([], /url/);
  rejects(["http://127.0.0.1/"], /out/);
  rejects(["not a url", "out.png"], /url/);
  rejects(["http://127.0.0.1/", "out.jpg"], /\.png/);
  rejects(["http://127.0.0.1/", "out.png", "--width", "0"], /width/);
  rejects(["http://127.0.0.1/", "out.png", "--lang", "日本語"], /--lang/);
  rejects(["http://127.0.0.1/", "out.png", "--height=-1"], /height/);
  rejects(["http://127.0.0.1/", "out.png", "--timeout", "1.5"], /timeoutMs/);
  rejects(["http://127.0.0.1/", "out.png", "--width", "wide"], /width/);
  rejects(["http://127.0.0.1/", "out.png", "--wait-for", ""], /waitFor/);
  rejects(["http://127.0.0.1/", "out.png", "--fill", "#code"], /--fill は/);
  assert.throws(() => parseScreenshotArgs(["http://127.0.0.1/", "out.png", "--unknown", "1"]));
});

test("DevToolsActivePort は、ポートとブラウザのパスの 2 行を読む", () => {
  assert.deepEqual(parseDevToolsActivePort("\n9222\n/devtools/browser/abc\n\n"), {
    port: 9222,
    browserPath: "/devtools/browser/abc",
  });
  assert.deepEqual(parseDevToolsActivePort("1\n/devtools/browser/x\n余分な行"), {
    port: 1,
    browserPath: "/devtools/browser/x",
  });
  for (const text of [
    "0\n/devtools/browser/abc",
    "-1\n/devtools/browser/abc",
    "92.5\n/devtools/browser/abc",
    "9222",
    "9222\n/devtools/page/abc",
    "port\n/devtools/browser/abc",
    "",
  ]) {
    assert.throws(() => parseDevToolsActivePort(text), /想定と違う/, JSON.stringify(text));
  }
});
