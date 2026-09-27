import { test } from "node:test";
import assert from "node:assert/strict";
import { HottubNews } from "../dist/index.js";
import { hottubNewsTools as aiTools } from "../dist/ai-sdk.js";
import { hottubNewsTools as lcTools } from "../dist/langchain.js";

function client(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(new URL(url));
    const body = handler(new URL(url), init);
    return typeof body === "string"
      ? new Response(body, { status: 200 })
      : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { hn: new HottubNews({ fetch, apiKey: "" }), calls };
}

test("AI SDK tools: live set by default, preview on request", () => {
  const { hn } = client(() => ({}));
  assert.deepEqual(Object.keys(aiTools({ client: hn })).sort(), [
    "get_news_item",
    "get_story",
    "list_sources",
    "news_stats",
    "quote_placement",
    "search_news",
    "sync_news",
  ]);
  assert.ok(aiTools({ client: hn, preview: true }).top_stories);
  assert.deepEqual(Object.keys(aiTools({ client: hn, include: ["search_news"] })), ["search_news"]);
});

test("AI SDK search_news executes against the API in md by default", async () => {
  const { hn, calls } = client(() => "- Headline\n");
  const tools = aiTools({ client: hn });
  assert.equal(typeof tools.search_news.description, "string");
  const out = await tools.search_news.execute({ q: "eclipse", lang: "en" }, { toolCallId: "1", messages: [] });
  assert.equal(out, "- Headline\n");
  assert.equal(calls[0].searchParams.get("format"), "md");
  assert.equal(calls[0].searchParams.get("limit"), "20");
  assert.equal(calls[0].searchParams.get("q"), "eclipse");
});

test("sync_news always returns JSON with the cursor", async () => {
  const { hn } = client(() => ({ schema: "hottub-news/list/v1", count: 0, cursor: 42, sponsored: 0, items: [] }));
  const out = await aiTools({ client: hn }).sync_news.execute({ after: 40 }, { toolCallId: "1", messages: [] });
  assert.equal(out.cursor, 42);
});

test("LangChain tools validate input and return strings", async () => {
  const { hn, calls } = client((u) => (u.pathname.startsWith("/v1/stories/") ? "- story md\n" : { cursor: 1, items: [] }));
  const tools = lcTools({ client: hn });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(await byName.get_story.invoke({ story: "st_abc" }), "- story md\n");
  assert.equal(calls[0].pathname, "/v1/stories/st_abc");
  assert.equal(await byName.news_stats.invoke({}), JSON.stringify({ cursor: 1, items: [] }));
  await assert.rejects(byName.sync_news.invoke({ after: "not a number" }));
});
