"""Hottub News: worldwide news for agents. https://hottub.news

    from hottub_news import HottubNews
    hn = HottubNews()
    page = hn.search("central bank rate decision", since="2d", collapse="story")
"""

from .client import (
    DEFAULT_BASE_URL,
    VERSION,
    HottubNews,
    HottubNewsError,
    Request,
    Response,
    Transport,
    UrllibTransport,
    to_query,
)
from .sse import StreamEvent, parse_sse

__version__ = VERSION

__all__ = [
    "HottubNews",
    "HottubNewsError",
    "Request",
    "Response",
    "Transport",
    "UrllibTransport",
    "StreamEvent",
    "parse_sse",
    "to_query",
    "DEFAULT_BASE_URL",
    "VERSION",
    "__version__",
]
