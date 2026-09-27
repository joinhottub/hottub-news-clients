# hottub-news (JavaScript / TypeScript)

Client and agent tools for [Hottub News](https://hottub.news): worldwide headlines from thousands
of outlets in 50+ languages, grouped into stories across outlets and languages, classified
(category, sentiment, tone, political), and honestly labeled when paid. Free to read, no key.
Provided by [Hottub, Inc.](https://joinhottub.com)

- Zero runtime dependencies. Uses the global `fetch`: Node 18+, Deno, Bun, browsers, Cloudflare Workers.
- ESM, fully typed.
- Optional tool wrappers for the [Vercel AI SDK](https://ai-sdk.dev) (`hottub-news/ai-sdk`) and
  [LangChain.js](https://js.langchain.com) (`hottub-news/langchain`), with no hard dependencies.

Hottub's own stack is Rust-first; this client is native TypeScript because it plugs into JavaScript agent frameworks.

```sh
npm install hottub-news
```

## Quickstart

```ts
import { HottubNews } from "hottub-news";

const hn = new HottubNews();

// Search by meaning and keyword, any language. One item per story.
const { items } = await hn.search("central bank rate decision", { since: "2d", collapse: "story" });

// Every outlet's report of the first story, in every language.
const story = await hn.story(items[0].story!);
for (const it of story.items) console.log(it.lang, it.source.name, it.title);

// What everyone is covering right now.
const hot = await hn.hot({ lang: "en", limit: 10 });

// Filters: lang, country, topic, source, kind, category, sentiment, political, tone_min/max, since/until…
const science = await hn.items({ category: "science-technology", political: false, sort: "positive" });

// Token-cheap text for an LLM prompt ("md" or "lines"). Paid items are prefixed
// "[SPONSORED PRESS RELEASE · paid by …]" in every text format.
const md = await hn.text({ q: "wildfire", since: "1d" }, "md");
```

### Incremental sync

```ts
let cursor = (await hn.stats()).cursor - 1000; // or 0 for everything retained, or a saved cursor
const feed = hn.syncAll({ after: cursor, lang: ["en", "es"] }, { follow: true, pollMs: 60_000 });
for await (const item of feed) {
  cursor = item.seq!; // persist this to resume later
  console.log(item.title);
}
```

`sync({ after })` returns one page (oldest first) with the next `cursor`. `syncAll` pages until caught
up (returning the final cursor), or keeps polling with `follow: true` until you abort via `signal`.

### Everything else

| Method | Endpoint |
| --- | --- |
| `items(query)` / `search(q, query)` / `hot(query)` / `text(query, format)` | `GET /v1/items` |
| `paginate(query, { maxPages })` | follows `next` |
| `sync({ after, ... })` / `syncAll(...)` | `GET /v1/items?after=` |
| `item(id)` | `GET /v1/items/{id}` |
| `story(id)` / `storyText(id, "md")` | `GET /v1/stories/{story}` |
| `sources({ q, country, lang, limit, offset })` | `GET /v1/sources` |
| `stats()` | `GET /v1/stats` |
| `pricing()` / `quote({ topics, lang, country, days })` / `sponsored()` | paid placement rate card, quotes, running placements |
| `get(path, query)` / `request(method, path, query, body)` | anything else |

Errors throw `HottubNewsError` with `status`, `code` (e.g. `not_found`) and `retryAfter`.
429/502/503/504 are retried (default 2 times) honoring `Retry-After`. Please keep to about one
request per second; responses are edge-cached.

### Coming soon (the methods are here now)

These need server endpoints that are being rolled out. Until they are deployed they throw a
`HottubNewsError` with status 404.

| Method | Endpoint |
| --- | --- |
| `stories({ lang, country, category, limit })` | `GET /v1/stories`: top stories with briefs |
| `entities(q)` and the `entity: "Q312"` filter on items | `GET /v1/entities?q=`, Wikidata QIDs |
| `new HottubNews({ apiKey: "hn_..." })` / `createKey({ name, email })` | optional keys (`Authorization: Bearer`), `POST /v1/keys` |
| `subscriptions.create({ webhook, filter })`, `.list()`, `.get(id)`, `.delete(id)` | `/v1/subscriptions` |
| `stream(query, { signal })` | `GET /v1/stream` Server-Sent Events |

`title_en` (English title) and `entities` appear on items once the server sends them.
The API key defaults to `process.env.HOTTUB_NEWS_API_KEY` when that exists. `stream()` parses SSE
from the `fetch` body, so it works in Node and Workers, sends the key header, and resumes with
`Last-Event-ID`:

```ts
const ac = new AbortController();
for await (const ev of hn.stream({ entity: "Q312", lang: "en" }, { signal: ac.signal })) {
  if (ev.event === "item") console.log(ev.data);
}
```

## Vercel AI SDK

```sh
npm install hottub-news ai zod
```

```ts
import { generateText, stepCountIs } from "ai";
import { hottubNewsTools } from "hottub-news/ai-sdk";

const { text } = await generateText({
  model, // any AI SDK model or AI Gateway model string
  tools: hottubNewsTools(),
  stopWhen: stepCountIs(5),
  prompt: "How are outlets in different countries covering today's biggest story?",
});
```

Built with `tool({ description, inputSchema, execute })` (AI SDK 5 and later).

## LangChain.js

```sh
npm install hottub-news @langchain/core zod
```

```ts
import { hottubNewsTools } from "hottub-news/langchain";

const tools = hottubNewsTools(); // DynamicStructuredTool[]; results are strings
// e.g. createAgent({ model, tools }) or model.bindTools(tools)
```

### Tool options (both frameworks)

| Option | Default | |
| --- | --- | --- |
| `format` | `"md"` | `"md"` is compact and keeps the sponsored label in the title; `"json"` returns raw objects. `sync_news` always returns JSON (it needs the cursor). |
| `include` | live tools | Subset of `search_news`, `sync_news`, `get_story`, `get_news_item`, `list_sources`, `news_stats`, `quote_placement`, `top_stories`, `find_entities`. |
| `preview` | `false` | Also add `top_stories` and `find_entities` (need the endpoints above). |
| `client` / `baseUrl` / `apiKey` / `fetch` | | Passed to `HottubNews`. |

The tool names match the Hottub News MCP server (`https://hottub.news/mcp`), so an agent that already knows
one knows the other.

## Paid placements

Businesses can pay to place press releases in the mix through Hottub Business. Every one has
`kind: "sponsored"` and a `disclosure` object; there are at most 3 per page, never first, never adjacent, and
never on searches. Show them as sponsored, or pass `sponsored: "exclude"`.

## Terms

Summaries are short excerpts supplied by publishers; the `url` is the story. Respect each source's terms
(`terms` on `/v1/sources`). See https://hottub.news/llms.txt.

## Development

```sh
npm install
npm test        # tsc build, then node:test against a mocked fetch
```

MIT © Hottub, Inc.
