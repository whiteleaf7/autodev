#!/usr/bin/env node
// withChrome のテスト用の偽の Chrome（VERIFY_CHROME で差し替える）。
// DevTools の WebSocket は接続を受けるだけで、要求には答えない
//   FAKE_CHROME_DROP=1: 要求が来たら接続を切る
//   FAKE_CHROME_IGNORE_SIGTERM=1: SIGTERM を無視する
const { createHash } = require("node:crypto");
const { createServer } = require("node:http");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const profile = (process.argv.find((arg) => arg.startsWith("--user-data-dir=")) ?? "").slice("--user-data-dir=".length);
if (process.env.FAKE_CHROME_IGNORE_SIGTERM) process.on("SIGTERM", () => {});

const server = createServer();
server.on("upgrade", (request, socket) => {
  const accept = createHash("sha1")
    .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.on("data", () => {
    if (process.env.FAKE_CHROME_DROP) socket.destroy();
  });
  socket.on("error", () => {});
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  writeFileSync(join(profile, "DevToolsActivePort"), `${port}\n/devtools/browser/fake\n`);
});
