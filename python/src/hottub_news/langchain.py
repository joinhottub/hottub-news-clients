"""LangChain tools: ``pip install "hottub-news[langchain]"``.

    from hottub_news.langchain import hottub_news_tools
    tools = hottub_news_tools()          # list[StructuredTool]
    agent = create_agent(model, tools)   # or model.bind_tools(tools)
"""

from typing import Any, List, Optional, Sequence

try:
    from langchain_core.tools import StructuredTool
except ImportError as e:  # pragma: no cover
    raise ImportError('hottub_news.langchain needs langchain-core: pip install "hottub-news[langchain]"') from e

from ._tools import tool_functions
from .client import HottubNews

__all__ = ["hottub_news_tools"]


def hottub_news_tools(
    client: Optional[HottubNews] = None,
    *,
    format: str = "md",
    include: Optional[Sequence[str]] = None,
    preview: bool = False,
    **client_options: Any,
) -> List[StructuredTool]:
    """Hottub News tools as LangChain ``StructuredTool`` objects (results are strings).

    ``format``: "md" (default; compact, paid items labeled in the title) or "json".
    ``include``: subset of tool names. ``preview``: also add ``top_stories`` and ``find_entities``,
    which need endpoints still being rolled out. Other keyword arguments go to :class:`HottubNews`.
    """
    return [
        StructuredTool.from_function(func=d.fn, name=d.name, description=d.description)
        for d in tool_functions(client, format=format, include=include, preview=preview, **client_options)
    ]
