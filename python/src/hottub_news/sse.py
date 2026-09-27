"""Server-Sent Events parsing (WHATWG EventSource rules) over any iterable of byte chunks."""

from __future__ import annotations

import codecs
import json
import re
from dataclasses import dataclass
from typing import Any, Iterable, Iterator, List, Optional

__all__ = ["StreamEvent", "parse_sse"]

_NEWLINE = re.compile(r"\r\n|\r|\n")


@dataclass
class StreamEvent:
    event: str
    #: Parsed as JSON when possible, otherwise the raw text.
    data: Any
    id: Optional[str] = None
    retry: Optional[int] = None


def parse_sse(chunks: Iterable[bytes]) -> Iterator[StreamEvent]:
    decoder = codecs.getincrementaldecoder("utf-8")()
    buf = ""
    event = ""
    data: List[str] = []
    last_id: Optional[str] = None
    retry: Optional[int] = None

    def lines(final: bool) -> Iterator[str]:
        nonlocal buf
        while True:
            m = _NEWLINE.search(buf)
            if not m:
                return
            # Don't split a CRLF across chunks.
            if m.group() == "\r" and m.end() == len(buf) and not final:
                return
            line, buf = buf[: m.start()], buf[m.end() :]
            yield line

    def handle(line: str) -> Optional[StreamEvent]:
        nonlocal event, data, last_id, retry
        if line == "":
            if not data:
                event = ""
                return None
            raw = "\n".join(data)
            try:
                value: Any = json.loads(raw)
            except ValueError:
                value = raw
            ev = StreamEvent(event or "message", value, last_id, retry)
            event, data = "", []
            return ev
        if line.startswith(":"):
            return None
        name, _, val = line.partition(":")
        if val.startswith(" "):
            val = val[1:]
        if name == "event":
            event = val
        elif name == "data":
            data.append(val)
        elif name == "id" and "\0" not in val:
            last_id = val
        elif name == "retry" and val.isdigit():
            retry = int(val)
        return None

    for chunk in chunks:
        buf += decoder.decode(chunk)
        for line in lines(False):
            ev = handle(line)
            if ev is not None:
                yield ev
    buf += decoder.decode(b"", final=True)
    for line in lines(True):
        ev = handle(line)
        if ev is not None:
            yield ev
    # An incomplete trailing event is discarded, per spec.
