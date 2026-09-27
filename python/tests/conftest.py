import json
from urllib.parse import parse_qs, urlsplit

import pytest

from hottub_news import HottubNews, Response


class FakeTransport:
    """Records requests and answers from a handler(request, n) -> dict | str | Response."""

    def __init__(self, handler):
        self.handler = handler
        self.requests = []

    def __call__(self, req):
        self.requests.append(req)
        out = self.handler(req, len(self.requests))
        if isinstance(out, Response):
            return out
        if isinstance(out, str):
            return Response(200, {"Content-Type": "text/plain"}, out.encode())
        return Response(200, {"Content-Type": "application/json"}, json.dumps(out).encode())

    def query(self, i=-1):
        return {k: v[0] for k, v in parse_qs(urlsplit(self.requests[i].url).query).items()}

    def path(self, i=-1):
        return urlsplit(self.requests[i].url).path


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.delenv("HOTTUB_NEWS_API_KEY", raising=False)
    monkeypatch.setattr("time.sleep", lambda s: None)

    def make(handler):
        t = FakeTransport(handler)
        return HottubNews(transport=t), t

    return make


def item(seq, **extra):
    base = {
        "id": "n_" + str(seq).rjust(20, "a"),
        "seq": seq,
        "kind": "article",
        "title": f"Item {seq}",
        "url": f"https://example.com/{seq}",
        "published": "2026-09-27T00:00:00Z",
        "seen": "2026-09-27T00:00:00Z",
        "source": {"id": "ex", "name": "Example"},
        "via": "ex",
    }
    base.update(extra)
    return base
