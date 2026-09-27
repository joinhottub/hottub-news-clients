import json

import pytest

from conftest import FakeTransport
from hottub_news import HottubNews

LIVE = ["search_news", "sync_news", "get_story", "get_news_item", "list_sources", "news_stats", "quote_placement"]


def client(handler):
    t = FakeTransport(handler)
    return HottubNews(api_key="", transport=t), t


def test_langchain_tools():
    pytest.importorskip("langchain_core")
    from hottub_news.langchain import hottub_news_tools

    hn, t = client(lambda req, n: "- Headline\n" if "format=md" in req.url else {"cursor": 42, "items": []})
    tools = {x.name: x for x in hottub_news_tools(hn)}
    assert list(tools) == LIVE
    assert "top_stories" in [x.name for x in hottub_news_tools(hn, preview=True)]

    assert tools["search_news"].invoke({"q": "eclipse", "lang": "en"}) == "- Headline\n"
    assert t.query() == {"q": "eclipse", "lang": "en", "limit": "20", "format": "md"}
    schema = tools["search_news"].args
    assert "Comma-separated ISO 639-1" in schema["lang"]["description"]

    assert json.loads(tools["sync_news"].invoke({"after": 40}))["cursor"] == 42
    assert t.query()["after"] == "40"
    with pytest.raises(Exception):
        tools["sync_news"].invoke({"after": "not a number"})

    assert tools["get_story"].invoke({"story": "st_abc"}) == "- Headline\n"
    assert t.path() == "/v1/stories/st_abc"


def test_llamaindex_tools():
    pytest.importorskip("llama_index.core")
    from hottub_news.llamaindex import hottub_news_tools

    hn, t = client(lambda req, n: {"schema": "hottub-news/stats/v1", "cursor": 7})
    tools = {x.metadata.name: x for x in hottub_news_tools(hn, format="json")}
    assert list(tools) == LIVE
    out = tools["news_stats"].call()
    assert json.loads(out.content)["cursor"] == 7
    props = tools["search_news"].metadata.fn_schema.model_json_schema()["properties"]
    assert "sort" in props and "q" in props
    tools["search_news"].call(q="flood", sort="hot")
    assert t.query() == {"q": "flood", "sort": "hot", "limit": "20", "format": "json"}
