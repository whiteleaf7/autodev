import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDevToolsActivePort, parseScreenshotArgs } from "../src/options.ts";
import { screenshot } from "../src/screenshot.ts";

test("引数を既定値つきで読む", () => {
  assert.deepEqual(parseScreenshotArgs(["http://127.0.0.1:4848/", "out.png", "--wait-for", ".card"]), {
    url: "http://127.0.0.1:4848/",
    out: "out.png",
    waitFor: ".card",
    click: [],
    width: 1280,
    height: 800,
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

test("ページを撮り、撮る前に指定の要素をクリックし、コンソールのエラーも返す", { skip: !chromeInstalled && "Chrome がない" }, async () => {
  const html = `<p id="ready">hi</p><button id="b" onclick="console.error('clicked')">b</button><script>console.error("boom")</script>`;
  const out = join(await mkdtemp(join(tmpdir(), "nagaya-verify-test-")), "page.png");
  const result = await screenshot({
    url: `data:text/html,${encodeURIComponent(html)}`,
    out,
    waitFor: "#ready",
    click: ["#b"],
    width: 320,
    height: 200,
    timeoutMs: 15_000,
  });
  const png = await readFile(result.out);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 320);
  assert.deepEqual(result.problems, ["console.error: boom", "console.error: clicked"]);
});
