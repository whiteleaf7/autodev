// pnpm verify:app --open-link の受け口: 殻で押したリンクが、既定のブラウザで本当に開いたかを、ブラウザから届いた要求で確かめる。
// ブラウザの履歴（ユーザーのデータ）を読まずに済むよう、一度きりの印を付けたパスを 127.0.0.1 で待つ

import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";

// 開いたページは自分を閉じようとし、閉じられなかったら少し後にこのパスを叩く（タブが残ったかを知るため）
const STILL_OPEN = "still-open";
export const STILL_OPEN_AFTER_MS = 1_000;

export type Arrival = { at: string; userAgent: string | null };

export type Route = "open" | "still-open" | "wrong-host" | "not-found";

// 待ち受けている Host 以外から来た要求は、DNS の付け替えなどで届いたものとして断る
export function route(
  host: string | undefined,
  path: string | undefined,
  expected: { host: string; path: string },
): Route {
  if (host !== expected.host) return "wrong-host";
  if (path === expected.path) return "open";
  if (path === `${expected.path}/${STILL_OPEN}`) return "still-open";
  return "not-found";
}

const page = (path: string) => `<!doctype html>
<meta charset="utf-8">
<title>nagaya verify</title>
<p>nagaya の確認（pnpm verify:app --open-link）が、このタブが開いたことを受け取った。閉じてよい。</p>
<script>
window.close();
setTimeout(() => fetch(${JSON.stringify(`${path}/${STILL_OPEN}`)}), ${STILL_OPEN_AFTER_MS});
</script>
`;

export class LinkReceiver {
  // 最初に届いた要求だけを残す
  arrival: Arrival | null = null;
  tabStayedOpen = false;
  readonly url: string;
  private readonly server: Server;

  private constructor(server: Server, port: number) {
    this.server = server;
    const expected = { host: `127.0.0.1:${port}`, path: `/nagaya-verify-link/${randomUUID()}` };
    this.url = `http://${expected.host}${expected.path}`;
    server.on("request", (request, response) => {
      const kind = route(request.headers.host, request.url, expected);
      if (kind === "open") {
        this.arrival ??= { at: new Date().toISOString(), userAgent: request.headers["user-agent"] ?? null };
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(page(expected.path));
        return;
      }
      if (kind === "still-open") this.tabStayedOpen = true;
      response.writeHead(kind === "wrong-host" ? 421 : kind === "still-open" ? 204 : 404);
      response.end();
    });
  }

  static async start(): Promise<LinkReceiver> {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("受け口のポートを得られない");
    return new LinkReceiver(server, address.port);
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    this.server.close();
    await once(this.server, "close");
  }
}
