import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDevToolsActivePort, parseScreenshotArgs } from "../src/options.ts";
import { screenshot } from "../src/screenshot.ts";

test("引数を既定値つきで読む", () => {
  assert.deepEqual(parseScreenshotArgs(["http://127.0.0.1:4848/", "out.png", "--wait-for", ".card"]), {
    url: "http://127.0.0.1:4848/",
    out: "out.png",
    waitFor: ".card",
    fill: [],
    click: [],
    waitAfter: undefined,
    width: 1280,
    height: 800,
    mobile: false,
    dark: false,
    timeoutMs: 15_000,
  });
});

test("URL や出力先が正しくなければ使い方を添えて断る", () => {
  assert.throws(() => parseScreenshotArgs(["not a url", "out.png"]), /使い方/);
  assert.throws(() => parseScreenshotArgs(["http://127.0.0.1/", "out.jpg"]), /\.png/);
  assert.throws(() => parseScreenshotArgs(["http://127.0.0.1/", "out.png", "--width", "0"]), /使い方/);
});

test("DevToolsActivePort からポートとパスを読む", () => {
  assert.deepEqual(parseDevToolsActivePort("53211\n/devtools/browser/abc-123\n"), {
    port: 53211,
    browserPath: "/devtools/browser/abc-123",
  });
  assert.throws(() => parseDevToolsActivePort("nope"), /想定と違う/);
});

const chromeInstalled = existsSync(
  process.env.NAGAYA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
);

test("ページを撮り、撮る前に入力欄に値を入れて指定の要素をクリックし、コンソールのエラーも返す", {
  skip: !chromeInstalled && "Chrome がない",
}, async (t) => {
  const html = [
    '<p id="ready">hi</p><input id="code" oninput="window.typed = this.value">',
    `<button id="b" onclick="console.error('clicked ' + window.typed); document.body.append(Object.assign(document.createElement('p'), { id: 'done' }))">b</button>`,
    '<script>console.error("boom")</script>',
  ].join("");
  const dir = await mkdtemp(join(tmpdir(), "nagaya-verify-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = join(dir, "page.png");
  const result = await screenshot({
    url: `data:text/html,${encodeURIComponent(html)}`,
    out,
    waitFor: "#ready",
    fill: [{ selector: "#code", value: "ABCD" }],
    click: ["#b"],
    waitAfter: "#done",
    width: 320,
    height: 200,
    mobile: false,
    dark: false,
    timeoutMs: 15_000,
  });
  const png = await readFile(result.out);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 320);
  assert.deepEqual(result.problems, ["console.error: boom", "console.error: clicked ABCD"]);
});

test("--mobile では、スクロールバーが幅を取らず、タッチの端末として 2 倍の解像度で撮る", {
  skip: !chromeInstalled && "Chrome がない",
}, async (t) => {
  const html = [
    '<meta name="viewport" content="width=device-width"><div style="height:3000px"></div>',
    "<script>console.error(document.documentElement.clientWidth, matchMedia('(pointer: coarse)').matches)</script>",
  ].join("");
  const dir = await mkdtemp(join(tmpdir(), "nagaya-verify-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const shoot = (mobile: boolean) =>
    screenshot({
      url: `data:text/html,${encodeURIComponent(html)}`,
      out: join(dir, `${mobile}.png`),
      fill: [],
      click: [],
      width: 390,
      height: 844,
      mobile,
      dark: false,
      timeoutMs: 15_000,
    });

  const desktop = await shoot(false);
  assert.equal((await readFile(desktop.out)).readUInt32BE(16), 390);
  // パソコンとして描くと、スクロールバーの分だけ幅が 390 より狭く、タッチの端末でもない
  assert.match(desktop.problems.join("\n"), /^console\.error: 3[0-8]\d false$/);

  const mobile = await shoot(true);
  assert.equal((await readFile(mobile.out)).readUInt32BE(16), 780);
  assert.deepEqual(mobile.problems, ["console.error: 390 true"]);
});

test("--dark では、prefers-color-scheme を dark にして描く", {
  skip: !chromeInstalled && "Chrome がない",
}, async (t) => {
  const html = "<script>console.error(matchMedia('(prefers-color-scheme: dark)').matches)</script>";
  const dir = await mkdtemp(join(tmpdir(), "nagaya-verify-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const shoot = (dark: boolean) =>
    screenshot({
      url: `data:text/html,${encodeURIComponent(html)}`,
      out: join(dir, `${dark}.png`),
      fill: [],
      click: [],
      width: 320,
      height: 200,
      mobile: false,
      dark,
      timeoutMs: 15_000,
    });
  assert.deepEqual((await shoot(false)).problems, ["console.error: false"]);
  assert.deepEqual((await shoot(true)).problems, ["console.error: true"]);
});
