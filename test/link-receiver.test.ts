import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkReceiver, route } from "../src/link-receiver.ts";

test("待ち受けの Host と印の付いたパスだけを、開いた知らせとして受ける", () => {
  const expected = { host: "127.0.0.1:4321", path: "/nagaya-verify-link/abc" };
  assert.equal(route("127.0.0.1:4321", "/nagaya-verify-link/abc", expected), "open");
  assert.equal(route("127.0.0.1:4321", "/nagaya-verify-link/abc/still-open", expected), "still-open");
  assert.equal(route("127.0.0.1:4321", "/nagaya-verify-link/other", expected), "not-found");
  assert.equal(route("evil.example:4321", "/nagaya-verify-link/abc", expected), "wrong-host");
  assert.equal(route(undefined, "/nagaya-verify-link/abc", expected), "wrong-host");
});

test("最初に届いた要求の時刻と User-Agent を残し、タブが残った知らせを受ける", async () => {
  const receiver = await LinkReceiver.start();
  // 要求のたびに変わるので、先の確かめで型が null に絞られないよう毎回読む
  const arrived = () => receiver.arrival;
  try {
    assert.match(receiver.url, /^http:\/\/127\.0\.0\.1:\d+\/nagaya-verify-link\/[0-9a-f-]{36}$/);
    const missed = await fetch(new URL("/nagaya-verify-link/other", receiver.url));
    assert.equal(missed.status, 404);
    assert.equal(arrived(), null);

    const opened = await fetch(receiver.url, { headers: { "user-agent": "first" } });
    assert.equal(opened.status, 200);
    assert.match(await opened.text(), /window\.close\(\)/);
    await fetch(receiver.url, { headers: { "user-agent": "second" } });
    assert.equal(arrived()?.userAgent, "first");
    assert.ok(!Number.isNaN(Date.parse(arrived()?.at ?? "")));

    assert.equal(receiver.tabStayedOpen, false);
    assert.equal((await fetch(`${receiver.url}/still-open`)).status, 204);
    assert.equal(receiver.tabStayedOpen, true);
  } finally {
    await receiver.close();
  }
});
