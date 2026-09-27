# hottub-news (Python)

Client and agent tools for [Hottub News](https://hottub.news): worldwide headlines from thousands
of outlets in 50+ languages, grouped into stories across outlets and languages, classified
(category, sentiment, tone, political), and honestly labeled when paid. Free to read, no key.
Provided by [Hottub, Inc.](https://joinhottub.com)

- The core client uses only the standard library (`urllib`). Python 3.9+.
- Optional tool wrappers for [LangChain](https://python.langchain.com) (`hottub_news.langchain`) and
  [LlamaIndex](https://docs.llamaindex.ai) (`hottub_news.llamaindex`).

Hottub's own stack is Rust-first; this client is native Python because it plugs into Python agent frameworks.

```sh
pip install hottub-news
pip install "hottub-news[langchain]"    # + langchain-core
pip install "hottub-news[llamaindex]"   # + llama-index-core
```

## Quickstart

```python
from hottub_news import HottubNews

hn = HottubNews()

# Search by meaning and keyword, any language. One item per story.
page = hn.search("central bank rate decision", since="2d", collapse="story")

# Every outlet's report of the first story, in every language.
story = hn.story(page["items"][0]["story"])
for it in story["items"]:
    print(it.get("lang"), it["source"]["name"], it["title"])

# What everyone is covering right now.
hot = hn.hot(lang="en", limit=10)

# Filters: lang, country, topic, source, kind, category, sentiment, political, tone_min/max, since/until...
# Lists are comma-joined: lang=["en", "es"] -> lang=en,es
science = hn.items(category="science-technology", political=False, sort="positive")

# Token-cheap text for a prompt ("md" or "lines"). Paid items are prefixed
# "[SPONSORED PRESS RELEASE · paid by …]" in every text format.
md = hn.text("md", q="wildfire", since="1d")
```

Responses are plain `dict`s in the documented schema (`hottub-news/list/v1`, `hottub-news/item/v1`); see
https://hottub.news/openapi.json and https://hottub.news/schema/item.json.

### Incremental sync

```python
cursor = hn.stats()["cursor"] - 1000   # or 0, or a saved cursor
for item in hn.sync_all(after=cursor, lang=["en", "es"], follow=True, poll_seconds=60):
    cursor = item["seq"]               # persist this to resume later
    print(item["title"])
```

`sync(after)` returns one page (oldest first) with the next `cursor`. `sync_all` pages until caught up,
or keeps polling with `follow=True`.

### Everything else

| Method | Endpoint |
| --- | --- |
| `items(**q)` / `search(q, **q)` / `hot(**q)` / `text(format, **q)` | `GET /v1/items` |
| `paginate(max_pages=10, **q)` | follows `next` |
| `sync(after, **q)` / `sync_all(after, follow=False, **q)` | `GET /v1/items?after=` |
| `item(id)` | `GET /v1/items/{id}` |
| `story(id)` / `story_text(id, "md")` | `GET /v1/stories/{story}` |
| `sources(q=, country=, lang=, limit=, offset=)` | `GET /v1/sources` |
| `stats()` | `GET /v1/stats` |
| `pricing()` / `quote(topics=, lang=, country=, days=)` / `sponsored()` | paid placement rate card, quotes, running placements |
| `get(path, query)` / `request(method, path, query, json_body)` | anything else |

Errors raise `HottubNewsError` with `.status`, `.code` (e.g. `not_found`) and `.retry_after`.
429/502/503/504 and network errors are retried (default 2 times), honoring `Retry-After`. Please keep to
about one request per second; responses are edge-cached.

### Coming soon (the methods are here now)

These need server endpoints that are being rolled out. Until they are deployed they raise
`HottubNewsError` with status 404.

| Method | Endpoint |
| --- | --- |
| `stories(lang=, country=, category=, limit=)` | `GET /v1/stories`: top stories with briefs |
| `entities(q)` and the `entity="Q312"` filter on items | `GET /v1/entities?q=`, Wikidata QIDs |
| `HottubNews(api_key="hn_...")` / `create_key(name=, email=)` | optional keys (`Authorization: Bearer`), `POST /v1/keys` |
| `subscriptions.create(webhook, filter={...})`, `.list()`, `.get(id)`, `.delete(id)` | `/v1/subscriptions` |
| `stream(**q)` | `GET /v1/stream` Server-Sent Events |

`title_en` (English title) and `entities` appear on items once the server sends them. The API key defaults
to the `HOTTUB_NEWS_API_KEY` environment variable.

```python
for ev in hn.stream(entity="Q312", lang="en"):   # reconnects with Last-Event-ID
    if ev.event == "item":
        print(ev.data["title"])
```

### Custom transport

Everything goes through `transport(Request) -> Response`, so you can use another HTTP library or a fake in tests:

```python
from hottub_news import HottubNews, Response
hn = HottubNews(transport=lambda req: Response(200, {}, b'{"cursor": 1}'))
```

## LangChain

```python
from hottub_news.langchain import hottub_news_tools

tools = hottub_news_tools()          # list[StructuredTool]; results are strings
# e.g. create_agent(model, tools) or model.bind_tools(tools)
```

## LlamaIndex

```python
from hottub_news.llamaindex import hottub_news_tools

tools = hottub_news_tools()          # list[FunctionTool]
# e.g. FunctionAgent(tools=tools, llm=llm)
```

### Tool options (both frameworks)

| Option | Default | |
| --- | --- | --- |
| `format` | `"md"` | `"md"` is compact and keeps the sponsored label in the title; `"json"` returns JSON. `sync_news` is always JSON (it needs the cursor). |
| `include` | live tools | Subset of `search_news`, `sync_news`, `get_story`, `get_news_item`, `list_sources`, `news_stats`, `quote_placement`, `top_stories`, `find_entities`. |
| `preview` | `False` | Also add `top_stories` and `find_entities` (need the endpoints above). |
| `client` / other kwargs | | A `HottubNews` instance, or options for one. |

The tool names match the Hottub News MCP server (`https://hottub.news/mcp`).

## Paid placements

Businesses can pay to place press releases in the mix through Hottub Business. Every one has
`kind: "sponsored"` and a `disclosure` object; there are at most 3 per page, never first, never adjacent, and
never on searches. Show them as sponsored, or pass `sponsored="exclude"`.

## Terms

Summaries are short excerpts supplied by publishers; the `url` is the story. Respect each source's terms
(`terms` on `/v1/sources`). See https://hottub.news/llms.txt.

## Development

```sh
python -m venv .venv && .venv/bin/pip install -e ".[test,langchain,llamaindex]"
.venv/bin/pytest
```

MIT © Hottub, Inc.
