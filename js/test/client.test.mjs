import { test } from "node:test";
import assert from "node:assert/strict";
import { HottubNews, HottubNewsError, parseSSE, toQuery } from "../dist/index.js";

const item = (seq, extra = {}) => ({
  id: `n_${String(seq).padStart(20, "a")}`,
  seq,
  kind: "article",
  title: `Item ${seq}`,
  url: `https://example.com/${seq}`,
  published: "2026-09-27T00:00:00Z",
  seen: "2026-09-27T00:00:00Z",
  source: { id: "ex", name: "Example" },
  via: "ex",
  ...extra,
});

/** A fetch mock that records calls and answers from a handler. */
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: new URL(url), init });
    const r = await handler(new URL(url), init, calls.length);
    if (r instanceof Response) return r;
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fn, calls };
}

test("toQuery joins arrays, drops empties, formats dates", () => {
  assert.equal(
    toQuery({ lang: ["en", "es"], q: "a b", x: undefined, y: "", since: new Date("2026-01-01T00:00:00Z"), political: false }),
    "?lang=en%2Ces&q=a+b&since=2026-01-01T00%3A00%3A00.000Z&political=false",
  );
  assert.equal(toQuery({}), "");
});

test("items/search send the right query and parse JSON", async () => {
  const m = mockFetch(() => ({ schema: "hottub-news/list/v1", count: 1, sponsored: 0, items: [item(1, { score: 0.6 })] }));
  const hn = new HottubNews({ fetch: m.fn, apiKey: "" });
  const res = await hn.search("central bank", { lang: ["en", "de"], since: "2d", collapse: "story" });
  assert.equal(res.items[0].score, 0.6);
  const u = m.calls[0].url;
  assert.equal(u.origin + u.pathname, "https://hottub.news/v1/items");
  assert.equal(u.searchParams.get("q"), "central bank");
  assert.equal(u.searchParams.get("lang"), "en,de");
  assert.equal(u.searchParams.get("collapse"), "story");
  assert.equal(u.searchParams.get("format"), "json");
  assert.equal(m.calls[0].init.headers.Authorization, undefined);
});

test("apiKey is sent as a bearer token", async () => {
  const m = mockFetch(() => ({ schema: "hottub-news/stats/v1", items: 1, cursor: 5, last_24h: {} }));
  const hn = new HottubNews({ fetch: m.fn, apiKey: "hn_test" });
  const s = await hn.stats();
  assert.equal(s.cursor, 5);
  assert.equal(m.calls[0].init.headers.Authorization, "Bearer hn_test");
});

test("syncAll follows the cursor until caught up and returns it", async () => {
  const pages = { 0: [item(1), item(2)], 2: [item(3)] };
  const m = mockFetch((u) => {
    const after = Number(u.searchParams.get("after"));
    const items = pages[after] ?? [];
    const cursor = items.length ? items.at(-1).seq : after;
    return { schema: "hottub-news/list/v1", count: items.length, cursor, sponsored: 0, items };
  });
  const hn = new HottubNews({ fetch: m.fn, apiKey: "" });
  const it = hn.syncAll({ after: 0, limit: 2, lang: "en" });
  const seen = [];
  let r;
  while (!(r = await it.next()).done) seen.push(r.value.seq);
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(r.value, 3);
  assert.deepEqual(m.calls.map((c) => c.url.searchParams.get("after")), ["0", "2"]);
  assert.equal(m.calls[0].url.searchParams.get("lang"), "en");
});

test("story, sources, quote, item paths", async () => {
  const m = mockFetch((u) => ({ path: u.pathname, items: [], sources: [], lines: [] }));
  const hn = new HottubNews({ fetch: m.fn, apiKey: "" });
  await hn.story("st_abc");
  await hn.sources({ q: "nasa", limit: 5 });
  await hn.quote({ topics: ["ai", "space"], days: 7 });
  await hn.item("n_x/y");
  assert.deepEqual(
    m.calls.map((c) => c.url.pathname),
    ["/v1/stories/st_abc", "/v1/sources", "/v1/pricing/quote", "/v1/items/n_x%2Fy"],
  );
  assert.equal(m.calls[2].url.searchParams.get("topics"), "ai,space");
});

test("text() returns the raw body in the requested format", async () => {
  const m = mockFetch(() => new Response("- [SPONSORED PRESS RELEASE · paid by X] Y\n", { status: 200 }));
  const hn = new HottubNews({ fetch: m.fn, apiKey: "" });
  const md = await hn.text({ sort: "hot" }, "md");
  assert.match(md, /SPONSORED/);
  assert.equal(m.calls[0].url.searchParams.get("format"), "md");
});

test("API errors become HottubNewsError with code and status", async () => {
  const m = mockFetch(
    () =>
      new Response(JSON.stringify({ error: { code: "not_found", message: "no item with that id" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
  );
  const hn = new HottubNews({ fetch: m.fn, apiKey: "" });
  await assert.rejects(hn.item("n_nope"), (e) => {
    assert.ok(e instanceof HottubNewsError);
    assert.equal(e.status, 404);
    assert.equal(e.code, "not_found");
    return true;
  });
});

test("429 is retried after Retry-After", async () => {
  const m = mockFetch((_u, _i, n) =>
    n === 1
      ? new Response("{}", { status: 429, headers: { "retry-after": "0" } })
      : { schema: "hottub-news/list/v1", count: 0, sponsored: 0, items: [] },
  );
  const hn = new HottubNews({ fetch: m.fn, apiKey: "" });
  const res = await hn.items();
  assert.equal(res.count, 0);
  assert.equal(m.calls.length, 2);
});

test("subscriptions and keys POST JSON", async () => {
  const m = mockFetch((u, init) => ({ id: "sub_1", echo: init.body ? JSON.parse(init.body) : null, key: "hn_x" }));
  const hn = new HottubNews({ fetch: m.fn, apiKey: "" });
  const sub = await hn.subscriptions.create({ webhook: "https://example.com/hook", filter: { entity: "Q312" } });
  assert.equal(sub.echo.filter.entity, "Q312");
  assert.equal(m.calls[0].init.method, "POST");
  assert.equal(m.calls[0].init.headers["Content-Type"], "application/json");
  await hn.subscriptions.delete("sub_1");
  assert.equal(m.calls[1].init.method, "DELETE");
  assert.equal((await hn.createKey({ name: "me" })).key, "hn_x");
});

function streamOf(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

test("parseSSE handles split chunks, CRLF, comments, multi-line data", async () => {
  const body = streamOf([": hello\r\n", "event: item\r\nid: 7\r", "\ndata: {\"seq\":", "7}\r\n\r\n", "data: a\ndata: b\n\n", "data: partial"]);
  const out = [];
  for await (const ev of parseSSE(body)) out.push(ev);
  assert.deepEqual(out, [
    { event: "item", data: { seq: 7 }, id: "7" },
    { event: "message", data: "a\nb", id: "7" },
  ]);
});

test("stream() yields parsed events and sends Last-Event-ID on resume", async () => {
  const m = mockFetch(
    () => new Response(streamOf(["event: item\nid: 9\ndata: {\"seq\":9}\n\n"]), { status: 200, headers: { "content-type": "text/event-stream" } }),
  );
  const hn = new HottubNews({ fetch: m.fn, apiKey: "" });
  const events = [];
  for await (const ev of hn.stream({ lang: "en" }, { reconnect: false, lastEventId: "8" })) events.push(ev);
  assert.deepEqual(events, [{ event: "item", data: { seq: 9 }, id: "9" }]);
  assert.equal(m.calls[0].init.headers["Last-Event-ID"], "8");
  assert.equal(m.calls[0].url.pathname, "/v1/stream");
});
