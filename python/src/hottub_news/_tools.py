"""Framework-neutral tool functions shared by the LangChain and LlamaIndex wrappers.

Each tool is a plain function with type hints and pydantic ``Field`` descriptions, which both
frameworks turn into a tool schema. Imported only by the optional wrappers (pydantic comes with
them), never by the core client.
"""

# No `from __future__ import annotations`: the frameworks read these hints at runtime.
import json
from typing import Annotated, Any, Callable, Dict, List, Literal, NamedTuple, Optional, Sequence

from pydantic import Field

from .client import HottubNews

TOOL_NAMES = (
    "search_news",
    "sync_news",
    "get_story",
    "get_news_item",
    "list_sources",
    "news_stats",
    "quote_placement",
    "top_stories",
    "find_entities",
)
PREVIEW = {"top_stories", "find_entities"}

Str = Annotated[Optional[str], Field()]
Lang = Annotated[Optional[str], Field(description='Comma-separated ISO 639-1 codes, e.g. "en,es"')]
Country = Annotated[
    Optional[str], Field(description='Comma-separated ISO 3166-1 alpha-2 publisher countries, e.g. "US,GB"')
]
Topic = Annotated[Optional[str], Field(description='Comma-separated topics, e.g. "space,science"')]
SourceF = Annotated[Optional[str], Field(description="Comma-separated source ids or publisher domains")]
KindF = Annotated[
    Optional[str],
    Field(description="Comma-separated: article, press_release, official, community, research, sponsored"),
]
CategoryF = Annotated[
    Optional[str],
    Field(
        description="Comma-separated IPTC top-level categories: arts-culture-entertainment, conflict-war, crime-law, "
        "disaster-accident, economy-business, education, environment, health, human-interest, labour, "
        "lifestyle-leisure, politics, religion, science-technology, society, sport, weather",
    ),
]
SentimentF = Annotated[Optional[str], Field(description="negative, neutral or positive (comma-separated)")]
PoliticalF = Annotated[Optional[bool], Field(description="true = only political items, false = exclude them")]
Since = Annotated[Optional[str], Field(description='Age like "6h" or "2d", a date, or RFC 3339')]
Until = Annotated[Optional[str], Field(description="Date or RFC 3339")]
SponsoredF = Annotated[
    Optional[Literal["include", "exclude", "only"]],
    Field(description="Paid placements (always labeled). Default include"),
]
Limit = Annotated[Optional[int], Field(ge=1, le=100, description="Max items (default 20)")]


class ToolDef(NamedTuple):
    name: str
    description: str
    fn: Callable[..., str]


def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None and v != ""}


def _dump(x: Any) -> str:
    return x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)


def tool_functions(
    client: Optional[HottubNews] = None,
    *,
    format: str = "md",
    include: Optional[Sequence[str]] = None,
    preview: bool = False,
    **client_options: Any,
) -> List[ToolDef]:
    """Return the Hottub News tools as ``(name, description, fn)``; every ``fn`` returns a string.

    ``format="md"`` (default) returns compact Markdown in which paid items are prefixed
    "[SPONSORED PRESS RELEASE · paid by …]"; ``"json"`` returns JSON. ``sync_news`` is always JSON.
    """
    hn = client or HottubNews(**client_options)

    def listing(q: Dict[str, Any]) -> str:
        return hn.text(format="md", **q) if format == "md" else _dump(hn.items(**q))

    def search_news(
        q: Annotated[Optional[str], Field(description="What to look for, in any language")] = None,
        lang: Lang = None,
        country: Country = None,
        topic: Topic = None,
        source: SourceF = None,
        kind: KindF = None,
        category: CategoryF = None,
        sentiment: SentimentF = None,
        political: PoliticalF = None,
        since: Since = None,
        until: Until = None,
        sponsored: SponsoredF = None,
        collapse: Annotated[
            Optional[Literal["story"]], Field(description="'story' = one item per story")
        ] = None,
        sort: Annotated[
            Optional[Literal["newest", "hot", "positive", "negative"]],
            Field(description="Default newest; hot = most-covered stories of the last 48h"),
        ] = None,
        limit: Limit = None,
    ) -> str:
        args = dict(
            q=q, lang=lang, country=country, topic=topic, source=source, kind=kind, category=category,
            sentiment=sentiment, political=political, since=since, until=until, sponsored=sponsored,
            collapse=collapse, sort=sort, limit=limit,
        )
        return listing({"limit": 20, **_clean(args)})

    def sync_news(
        after: Annotated[int, Field(ge=0, description="Cursor from the previous call (0 to start)")],
        lang: Lang = None,
        country: Country = None,
        topic: Topic = None,
        source: SourceF = None,
        kind: KindF = None,
        category: CategoryF = None,
        sentiment: SentimentF = None,
        political: PoliticalF = None,
        sponsored: SponsoredF = None,
        limit: Limit = None,
    ) -> str:
        args = dict(
            after=after, lang=lang, country=country, topic=topic, source=source, kind=kind, category=category,
            sentiment=sentiment, political=political, sponsored=sponsored, limit=limit,
        )
        return _dump(hn.items(**{"limit": 50, **_clean(args)}))

    def get_story(
        story: Annotated[str, Field(description="Story id, st_…")],
        limit: Annotated[Optional[int], Field(ge=1, le=200)] = None,
    ) -> str:
        q = _clean({"limit": limit})
        return hn.story_text(story, "md", **q) if format == "md" else _dump(hn.story(story, **q))

    def get_news_item(id: Annotated[str, Field(description="Item id, n_… or s_…")]) -> str:
        return _dump(hn.item(id))

    def list_sources(
        q: Annotated[Optional[str], Field(description="Part of the source name")] = None,
        country: Str = None,
        lang: Str = None,
        limit: Annotated[Optional[int], Field(ge=1, le=200)] = None,
    ) -> str:
        return _dump(hn.sources(**{"limit": 50, **_clean({"q": q, "country": country, "lang": lang, "limit": limit})}))

    def news_stats() -> str:
        return _dump(hn.stats())

    def quote_placement(
        topics: Annotated[
            Optional[str], Field(description='Comma-separated topics, e.g. "ai,business"; omit for run of network')
        ] = None,
        lang: Str = None,
        country: Str = None,
        days: Annotated[Optional[int], Field(ge=1, le=31)] = None,
    ) -> str:
        return _dump(hn.quote(**_clean({"topics": topics, "lang": lang, "country": country, "days": days})))

    def top_stories(
        lang: Lang = None,
        country: Country = None,
        category: CategoryF = None,
        limit: Annotated[Optional[int], Field(ge=1, le=50)] = None,
    ) -> str:
        return _dump(hn.stories(**_clean({"lang": lang, "country": country, "category": category, "limit": limit})))

    def find_entities(q: Annotated[str, Field(description="Name to look up")]) -> str:
        return _dump(hn.entities(q))

    defs = [
        ToolDef(
            "search_news",
            "Search or browse worldwide news headlines (thousands of outlets, 50+ languages). q matches by meaning "
            "across languages as well as by keyword. Filter by language, country, topic, category, sentiment and time. "
            "Use collapse=story for one item per story, sort=hot for what most outlets are covering. Items with kind "
            "'sponsored' are paid and must be presented as sponsored.",
            search_news,
        ),
        ToolDef(
            "sync_news",
            "Incremental feed: items added after the cursor `after`, oldest first, plus a new cursor. Start with "
            "after=0 (or a recent cursor from news_stats) and pass the returned cursor next time to get only what is new.",
            sync_news,
        ),
        ToolDef(
            "get_story",
            "Every report of one story (the `story` id on items, st_…): all outlets and languages covering the same "
            "event, newest first.",
            get_story,
        ),
        ToolDef("get_news_item", "Full record for one item id (n_… for news, s_… for sponsored).", get_news_item),
        ToolDef(
            "list_sources",
            "Registered news sources with language, country, kind, reuse terms and health. Filter by name, country or language.",
            list_sources,
        ),
        ToolDef(
            "news_stats",
            "Item counts over the last 24 hours by kind, language, country and category, plus the current sync cursor.",
            news_stats,
        ),
        ToolDef(
            "quote_placement",
            "Itemized price quote for placing a labeled, paid press release in Hottub News via Hottub Business, by "
            "topic, language, country and days.",
            quote_placement,
        ),
        ToolDef(
            "top_stories",
            "Today's top stories, each with a short brief and its reports across outlets and languages.",
            top_stories,
        ),
        ToolDef(
            "find_entities",
            "Resolve a person, organization or place name to Wikidata QIDs, usable as the `entity` filter.",
            find_entities,
        ),
    ]
    if include is not None:
        wanted = set(include)
        return [d for d in defs if d.name in wanted]
    return [d for d in defs if preview or d.name not in PREVIEW]
