"""LlamaIndex tools: ``pip install "hottub-news[llamaindex]"``.

    from hottub_news.llamaindex import hottub_news_tools
    agent = FunctionAgent(tools=hottub_news_tools(), llm=llm)
"""

from typing import Any, List, Optional, Sequence

try:
    from llama_index.core.tools import FunctionTool
except ImportError as e:  # pragma: no cover
    raise ImportError('hottub_news.llamaindex needs llama-index-core: pip install "hottub-news[llamaindex]"') from e

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
) -> List[FunctionTool]:
    """Hottub News tools as LlamaIndex ``FunctionTool`` objects (results are strings).

    Same options as :func:`hottub_news.langchain.hottub_news_tools`.
    """
    return [
        FunctionTool.from_defaults(fn=d.fn, name=d.name, description=d.description)
        for d in tool_functions(client, format=format, include=include, preview=preview, **client_options)
    ]
