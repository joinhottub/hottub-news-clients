import json
from datetime import datetime, timezone

import pytest

from hottub_news import HottubNews, HottubNewsError, Response, parse_sse, to_query

from conftest import FakeTransport, item


def page(items, **extra):
    return {"schema": "hottub-news/list/v1", "count": len(items), "sponsored": 0, "items": items, **extra}


def test_to_query():
    q = to_query({"lang": ["en", "es"], "q": "a b", "x": None, "y": "", "political": False,
                  "since": datetime(2026, 1, 1, tzinfo=timezone.utc)})
    assert q == "?lang=en%2Ces&q=a+b&political=false&since=2026-01-01T00%3A00%3A00Z"
    assert to_query({}) == ""


def test_search(fake):
    hn, t = fake(lambda req, n: page([item(1, score=0.6)]))
    res = hn.search("central bank", lang=["en", "de"], since="2d", collapse="story")
    assert res["items"][0]["score"] == 0.6
    assert t.path() == "/v1/items"
    assert t.query() == {"q": "central bank", "lang": "en,de", "since": "2d", "collapse": "story", "format": "json"}
    assert "Authorization" not in t.requests[0].headers
    assert t.requests[0].headers["User-Agent"].startswith("hottub-news-python/")


def test_api_key_header(monkeypatch):
    monkeypatch.setenv("HOTTUB_NEWS_API_KEY", "hn_env")
    t = FakeTransport(lambda req, n: {"cursor": 5})
    assert HottubNews(transport=t).stats()["cursor"] == 5
    assert t.requests[0].headers["Authorization"] == "Bearer hn_env"
    HottubNews(api_key="hn_x", transport=t).stats()
    assert t.requests[1].headers["Authorization"] == "Bearer hn_x"


def test_sync_all(fake):
    pages = {0: [item(1), item(2)], 2: [item(3)]}

    def handler(req, n):
        after = int(t.query()["after"])
        items = pages.get(after, [])
        return page(items, cursor=items[-1]["seq"] if items else after)

    hn, t = fake(handler)
    seqs = [it["seq"] for it in hn.sync_all(after=0, limit=2, lang="en")]
    assert seqs == [1, 2, 3]
    assert [t.query(i)["after"] for i in range(len(t.requests))] == ["0", "2"]
    assert t.query(0)["lang"] == "en"


def test_paths(fake):
    hn, t = fake(lambda req, n: {"items": [], "sources": []})
    hn.story("st_abc")
    hn.sources(q="nasa", limit=5)
    hn.quote(topics=["ai", "space"], days=7)
    hn.item("n_x/y")
    hn.stats()
    assert [t.path(i) for i in range(5)] == [
        "/v1/stories/st_abc", "/v1/sources", "/v1/pricing/quote", "/v1/items/n_x%2Fy", "/v1/stats",
    ]
    assert t.query(2) == {"topics": "ai,space", "days": "7"}


def test_text(fake):
    hn, t = fake(lambda req, n: "- [SPONSORED PRESS RELEASE · paid by X] Y\n")
    assert "SPONSORED" in hn.text("md", sort="hot")
    assert t.query()["format"] == "md"


def test_error(fake):
    body = json.dumps({"error": {"code": "not_found", "message": "no item with that id"}}).encode()
    hn, t = fake(lambda req, n: Response(404, {"Content-Type": "application/json"}, body))
    with pytest.raises(HottubNewsError) as e:
        hn.item("n_nope")
    assert e.value.status == 404 and e.value.code == "not_found"
    assert len(t.requests) == 1


def test_retry_429(fake):
    hn, t = fake(lambda req, n: Response(429, {"Retry-After": "0"}, b"{}") if n == 1 else page([]))
    assert hn.items()["count"] == 0
    assert len(t.requests) == 2


def test_network_error_retries_then_raises(fake):
    def boom(req, n):
        raise OSError("connection reset")

    hn, t = fake(boom)
    with pytest.raises(HottubNewsError) as e:
        hn.stats()
    assert e.value.code == "network_error"
    assert len(t.requests) == 3


def test_subscriptions_and_keys(fake):
    hn, t = fake(lambda req, n: {"id": "sub_1", "key": "hn_x",
                                 "echo": json.loads(req.body) if req.body else None})
    sub = hn.subscriptions.create("https://example.com/hook", filter={"entity": "Q312"})
    assert sub["echo"] == {"webhook": "https://example.com/hook", "filter": {"entity": "Q312"}}
    assert t.requests[0].method == "POST"
    assert t.requests[0].headers["Content-Type"] == "application/json"
    hn.subscriptions.delete("sub_1")
    assert t.requests[1].method == "DELETE" and t.path(1) == "/v1/subscriptions/sub_1"
    assert hn.create_key(name="me")["key"] == "hn_x"


def test_parse_sse():
    chunks = [b": hello\r\n", b"event: item\r\nid: 7\r", b"\ndata: {\"seq\":", b"7}\r\n\r\n",
              b"data: a\ndata: b\n\n", "data: é\n\n".encode()[:7], "data: é\n\n".encode()[7:], b"data: partial"]
    evs = list(parse_sse(chunks))
    assert [(e.event, e.data, e.id) for e in evs] == [
        ("item", {"seq": 7}, "7"), ("message", "a\nb", "7"), ("message", "é", "7"),
    ]


def test_stream(fake):
    hn, t = fake(lambda req, n: Response(200, {"Content-Type": "text/event-stream"},
                                         iter([b"event: item\n", b"id: 9\n", b"data: {\"seq\":9}\n", b"\n"])))
    evs = list(hn.stream(reconnect=False, last_event_id="8", lang="en"))
    assert [(e.event, e.data, e.id) for e in evs] == [("item", {"seq": 9}, "9")]
    assert t.requests[0].headers["Last-Event-ID"] == "8"
    assert t.requests[0].stream is True
    assert t.path() == "/v1/stream" and t.query() == {"lang": "en"}
