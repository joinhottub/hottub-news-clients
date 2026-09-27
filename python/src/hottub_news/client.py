"""Hottub News client. Standard library only (urllib)."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, Iterator, Mapping, Optional, Union

from .sse import StreamEvent, parse_sse

__all__ = [
    "HottubNews",
    "HottubNewsError",
    "Request",
    "Response",
    "Transport",
    "UrllibTransport",
    "to_query",
    "DEFAULT_BASE_URL",
    "VERSION",
]

VERSION = "0.1.0"
DEFAULT_BASE_URL = "https://hottub.news"
RETRY_STATUSES = (429, 502, 503, 504)

Params = Mapping[str, Any]


class HottubNewsError(Exception):
    """An API error (``{"error": {"code", "message"}}``) or a transport failure (status 0)."""

    def __init__(
        self,
        message: str,
        status: int,
        code: str,
        body: Any = None,
        retry_after: Optional[float] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.body = body
        self.retry_after = retry_after


@dataclass
class Request:
    method: str
    url: str
    headers: Dict[str, str]
    body: Optional[bytes] = None
    timeout: Optional[float] = None
    stream: bool = False


@dataclass
class Response:
    status: int
    headers: Dict[str, str]
    #: Full body for normal requests; for ``stream=True`` requests, an iterator of byte chunks.
    body: Union[bytes, Iterable[bytes]] = b""
    close: Callable[[], None] = field(default=lambda: None)

    def header(self, name: str) -> Optional[str]:
        name = name.lower()
        for k, v in self.headers.items():
            if k.lower() == name:
                return v
        return None

    def read(self) -> bytes:
        if isinstance(self.body, (bytes, bytearray)):
            return bytes(self.body)
        return b"".join(self.body)

    def chunks(self) -> Iterator[bytes]:
        if isinstance(self.body, (bytes, bytearray)):
            yield bytes(self.body)
        else:
            yield from self.body


#: A transport sends a :class:`Request` and returns a :class:`Response` for every HTTP status
#: (it raises only for network failures). Swap it to use another HTTP library or to test.
Transport = Callable[[Request], Response]


class UrllibTransport:
    """Default transport using :mod:`urllib.request`."""

    def __call__(self, req: Request) -> Response:
        r = urllib.request.Request(req.url, data=req.body, headers=req.headers, method=req.method)
        try:
            resp = urllib.request.urlopen(r, timeout=req.timeout)
        except urllib.error.HTTPError as e:  # non-2xx: still a response
            try:
                body = e.read()
            finally:
                e.close()
            return Response(e.code, dict(e.headers.items()), body)
        headers = dict(resp.headers.items())
        if req.stream:

            def gen() -> Iterator[bytes]:
                try:
                    while True:
                        line = resp.readline()
                        if not line:
                            return
                        yield line
                finally:
                    resp.close()

            return Response(resp.status, headers, gen(), resp.close)
        try:
            return Response(resp.status, headers, resp.read())
        finally:
            resp.close()


def _value(v: Any) -> Optional[str]:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(v, (list, tuple, set, frozenset)):
        parts = [str(x) for x in v if x is not None and x != ""]
        return ",".join(parts) if parts else None
    return str(v)


def to_query(params: Optional[Params] = None) -> str:
    """Serialize query params: lists are comma-joined, datetimes become RFC 3339, None/"" dropped."""
    pairs = [(k, _value(v)) for k, v in (params or {}).items()]
    pairs = [(k, v) for k, v in pairs if v is not None]
    return "?" + urllib.parse.urlencode(pairs) if pairs else ""


class _Subscriptions:
    """Webhook subscriptions. Require server support; raise a 404 error until deployed."""

    def __init__(self, client: "HottubNews") -> None:
        self._c = client

    def create(self, webhook: str, filter: Optional[Params] = None, **extra: Any) -> Dict[str, Any]:
        body: Dict[str, Any] = {"webhook": webhook, **extra}
        if filter:
            body["filter"] = dict(filter)
        return self._c.request("POST", "/v1/subscriptions", json_body=body)

    def list(self) -> Dict[str, Any]:
        return self._c.request("GET", "/v1/subscriptions")

    def get(self, id: str) -> Dict[str, Any]:
        return self._c.request("GET", "/v1/subscriptions/" + urllib.parse.quote(id, safe=""))

    def delete(self, id: str) -> Any:
        return self._c.request("DELETE", "/v1/subscriptions/" + urllib.parse.quote(id, safe=""))


class HottubNews:
    """Client for the Hottub News API (https://hottub.news). Reading needs no key.

    >>> hn = HottubNews()
    >>> page = hn.search("central bank rate decision", since="2d", collapse="story")
    >>> [it["title"] for it in page["items"]]
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        api_key: Optional[str] = None,
        *,
        transport: Optional[Transport] = None,
        headers: Optional[Mapping[str, str]] = None,
        timeout: float = 30.0,
        max_retries: int = 2,
        user_agent: Optional[str] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key if api_key is not None else (os.environ.get("HOTTUB_NEWS_API_KEY") or None)
        self.transport: Transport = transport or UrllibTransport()
        self.headers = dict(headers or {})
        self.headers.setdefault("User-Agent", user_agent or f"hottub-news-python/{VERSION}")
        self.timeout = timeout
        self.max_retries = max_retries
        self.subscriptions = _Subscriptions(self)

    # ---- items ----------------------------------------------------------

    def items(self, **query: Any) -> Dict[str, Any]:
        """``GET /v1/items``. Filters: q, lang, country, topic, source, kind, entity, since, until,
        after, before, limit, sponsored, category, sentiment, political, tone_min, tone_max, match,
        collapse, per_source, sort. Lists are comma-joined."""
        return self.get("/v1/items", {**query, "format": "json"})

    def search(self, q: str, **query: Any) -> Dict[str, Any]:
        """Search by meaning and keyword across languages. Results carry ``score``."""
        return self.items(q=q, **query)

    def hot(self, **query: Any) -> Dict[str, Any]:
        """What everyone is covering: last 48h, one item per story, ranked by distinct outlets."""
        return self.items(**{**query, "sort": "hot"})

    def sync(self, after: int, **query: Any) -> Dict[str, Any]:
        """One page of the incremental feed: items with ``seq > after``, oldest first, and a new ``cursor``."""
        return self.items(after=after, **query)

    def sync_all(
        self,
        after: int = 0,
        *,
        follow: bool = False,
        poll_seconds: float = 60.0,
        limit: int = 500,
        **query: Any,
    ) -> Iterator[Dict[str, Any]]:
        """Iterate the sync feed from ``after``. Each item's ``seq`` is a resumable cursor.

        Stops when caught up, or with ``follow=True`` keeps polling every ``poll_seconds``.
        """
        while True:
            page = self.items(after=after, limit=limit, **query)
            items = page.get("items") or []
            yield from items
            nxt = page.get("cursor")
            if nxt is None:
                nxt = items[-1].get("seq", after) if items else after
            caught_up = len(items) < limit or nxt <= after
            after = nxt
            if caught_up:
                if not follow:
                    return
                time.sleep(poll_seconds)

    def paginate(self, max_pages: int = 10, **query: Any) -> Iterator[Dict[str, Any]]:
        """Page through a browse/search result by following ``next``."""
        page = self.items(**query)
        n = 1
        while True:
            items = page.get("items") or []
            yield from items
            nxt = page.get("next")
            if not nxt or n >= max_pages or not items:
                return
            page = self._json(self._send("GET", nxt, {"Accept": "application/json"}))
            n += 1

    def text(self, format: str = "md", **query: Any) -> str:
        """The same query as :meth:`items` in a text format: md, lines, ndjson, rss or jsonfeed.
        Paid items are prefixed "[SPONSORED PRESS RELEASE · paid by …]" in text formats."""
        return self.get_text("/v1/items", {**query, "format": format})

    def item(self, id: str) -> Dict[str, Any]:
        """``GET /v1/items/{id}``."""
        return self.get("/v1/items/" + urllib.parse.quote(id, safe=""))

    # ---- stories --------------------------------------------------------

    def story(self, story: str, **query: Any) -> Dict[str, Any]:
        """``GET /v1/stories/{story}``: every report of one event across outlets and languages."""
        return self.get("/v1/stories/" + urllib.parse.quote(story, safe=""), {**query, "format": "json"})

    def story_text(self, story: str, format: str = "md", **query: Any) -> str:
        return self.get_text("/v1/stories/" + urllib.parse.quote(story, safe=""), {**query, "format": format})

    def stories(self, **query: Any) -> Dict[str, Any]:
        """``GET /v1/stories``: top stories with briefs. Requires server support; 404 until deployed."""
        return self.get("/v1/stories", {**query, "format": "json"})

    def section(self, slug: str, **query: Any) -> Dict[str, Any]:
        """``GET /v1/sections/{slug}``: "save-money", "make-money" or "entertainment", matched by meaning across languages. Takes ``limit``."""
        return self.get("/v1/sections/" + urllib.parse.quote(slug, safe=""), query)

    # ---- reference ------------------------------------------------------

    def sources(self, **query: Any) -> Dict[str, Any]:
        """``GET /v1/sources``: q, country, lang, limit, offset."""
        return self.get("/v1/sources", {**query, "format": "json"})

    def stats(self) -> Dict[str, Any]:
        """``GET /v1/stats``: counts over the last 24h and the current sync cursor."""
        return self.get("/v1/stats")

    def entities(self, q: str, **query: Any) -> Dict[str, Any]:
        """``GET /v1/entities?q=``: Wikidata QIDs for a name. Requires server support; 404 until deployed."""
        return self.get("/v1/entities", {**query, "q": q})

    # ---- placements -----------------------------------------------------

    def pricing(self) -> Dict[str, Any]:
        return self.get("/v1/pricing")

    def quote(self, **query: Any) -> Dict[str, Any]:
        """``GET /v1/pricing/quote``: topics, lang, country, days (1..31), starts."""
        return self.get("/v1/pricing/quote", query)

    def sponsored(self) -> Dict[str, Any]:
        """``GET /v1/sponsored``: every running paid placement."""
        return self.get("/v1/sponsored", {"format": "json"})

    # ---- keys, stream ---------------------------------------------------

    def create_key(self, **fields: Any) -> Dict[str, Any]:
        """``POST /v1/keys``: create an optional API key. Requires server support; 404 until deployed."""
        return self.request("POST", "/v1/keys", json_body=fields)

    def stream(
        self,
        *,
        reconnect: bool = True,
        last_event_id: Optional[str] = None,
        **query: Any,
    ) -> Iterator[StreamEvent]:
        """``GET /v1/stream`` Server-Sent Events of new items matching the filters.

        Reconnects with ``Last-Event-ID`` when the connection drops (unless ``reconnect=False``).
        Requires server support; raises a 404 :class:`HottubNewsError` until deployed.
        """
        retry = 3.0
        while True:
            headers = {"Accept": "text/event-stream"}
            if last_event_id:
                headers["Last-Event-ID"] = last_event_id
            resp = self._send("GET", self._url("/v1/stream", query), headers, stream=True, timeout=None)
            try:
                for ev in parse_sse(resp.chunks()):
                    if ev.id is not None:
                        last_event_id = ev.id
                    if ev.retry is not None:
                        retry = ev.retry / 1000.0
                    yield ev
            except (OSError, ValueError):
                if not reconnect:
                    raise
            finally:
                resp.close()
            if not reconnect:
                return
            time.sleep(retry)

    # ---- transport ------------------------------------------------------

    def get(self, path: str, query: Optional[Params] = None) -> Any:
        return self.request("GET", path, query)

    def get_text(self, path: str, query: Optional[Params] = None) -> str:
        resp = self._send("GET", self._url(path, query), {"Accept": "text/plain, */*"})
        return resp.read().decode("utf-8")

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Params] = None,
        json_body: Any = None,
    ) -> Any:
        headers = {"Accept": "application/json"}
        body = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(json_body).encode("utf-8")
        return self._json(self._send(method, self._url(path, query), headers, body))

    def _url(self, path: str, query: Optional[Params] = None) -> str:
        return self.base_url + path + to_query(query)

    @staticmethod
    def _json(resp: Response) -> Any:
        raw = resp.read()
        return json.loads(raw.decode("utf-8")) if raw else None

    def _send(
        self,
        method: str,
        url: str,
        headers: Dict[str, str],
        body: Optional[bytes] = None,
        *,
        stream: bool = False,
        timeout: Any = "default",
    ) -> Response:
        h = {**headers, **self.headers}
        if self.api_key:
            h["Authorization"] = "Bearer " + self.api_key
        attempt = 0
        while True:
            req = Request(method, url, h, body, self.timeout if timeout == "default" else timeout, stream)
            try:
                resp = self.transport(req)
            except (OSError, urllib.error.URLError) as e:
                if attempt >= self.max_retries:
                    raise HottubNewsError(f"request failed: {e}", 0, "network_error", e) from e
                time.sleep(0.5 * 2**attempt)
                attempt += 1
                continue
            if 200 <= resp.status < 300:
                return resp
            ra = resp.header("Retry-After")
            retry_after: Optional[float] = None
            if ra:
                try:
                    retry_after = float(ra)
                except ValueError:
                    pass
            if resp.status in RETRY_STATUSES and attempt < self.max_retries:
                resp.close()
                time.sleep(min(retry_after if retry_after is not None else 2**attempt, 60.0))
                attempt += 1
                continue
            raw = resp.read()
            resp.close()
            text = raw.decode("utf-8", "replace")
            code, message, parsed = f"http_{resp.status}", text[:300] or f"HTTP {resp.status}", text
            try:
                parsed = json.loads(text)
                err = parsed.get("error") if isinstance(parsed, dict) else None
                if isinstance(err, dict):
                    code = err.get("code") or code
                    message = err.get("message") or message
            except ValueError:
                pass
            raise HottubNewsError(f"{resp.status} {code}: {message}", resp.status, code, parsed, retry_after)

