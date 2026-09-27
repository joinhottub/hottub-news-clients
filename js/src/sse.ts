import type { StreamEvent } from "./types.js";

/**
 * Parse a `text/event-stream` body (per the WHATWG EventSource rules) into events.
 * Works on any `ReadableStream<Uint8Array>`, so it runs wherever `fetch` does.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  const dispatch = (): StreamEvent | undefined => {
    if (data.length === 0) {
      event = "";
      return undefined;
    }
    const raw = data.join("\n");
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // keep as text
    }
    const out: StreamEvent = { event: event || "message", data: parsed };
    if (id !== undefined) out.id = id;
    if (retry !== undefined) out.retry = retry;
    event = "";
    data = [];
    return out;
  };

  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r\n|\r|\n/)) >= 0) {
        // Don't split a CRLF across chunks: wait for more input if \r is last.
        if (buffer[nl] === "\r" && nl === buffer.length - 1 && !done) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer.startsWith("\r\n", nl) ? 2 : 1));
        if (line === "") {
          const ev = dispatch();
          if (ev) yield ev;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let val = colon < 0 ? "" : line.slice(colon + 1);
        if (val.startsWith(" ")) val = val.slice(1);
        if (field === "event") event = val;
        else if (field === "data") data.push(val);
        else if (field === "id" && !val.includes("\0")) id = val;
        else if (field === "retry" && /^\d+$/.test(val)) retry = Number(val);
      }
      if (done) {
        // Per spec, an incomplete trailing event is discarded.
        return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock?.();
  }
}
