import { parseSSE } from "./sse.js";
import type {
  ApiKey,
  ApiKeyRequest,
  EntityList,
  Item,
  ItemList,
  ItemQuery,
  Quote,
  QuoteQuery,
  SectionPage,
  SectionSlug,
  SourceList,
  SourceQuery,
  Stats,
  StoriesQuery,
  StoryList,
  StreamEvent,
  Subscription,
  SubscriptionRequest,
  TextFormat,
} from "./types.js";

export const VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://hottub.news";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HottubNewsOptions {
  /** Default `https://hottub.news`. */
  baseUrl?: string;
  /**
   * Optional API key (`hn_…`), sent as `Authorization: Bearer`. Reading works without one.
   * Defaults to `process.env.HOTTUB_NEWS_API_KEY` where `process` exists.
   */
  apiKey?: string;
  /** Custom fetch (defaults to the global `fetch`). */
  fetch?: FetchLike;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms (default 30000; streams are not timed out). */
  timeoutMs?: number;
  /** Retries on 429/502/503/504 and network errors, honoring `Retry-After` (default 2). */
  maxRetries?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** An error response from the API (`{"error": {"code", "message"}}`) or a transport failure. */
export class HottubNewsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;
  readonly body?: unknown;
  constructor(message: string, status: number, code: string, body?: unknown, retryAfter?: number) {
    super(message);
    this.name = "HottubNewsError";
    this.status = status;
    this.code = code;
    this.body = body;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/** Serialize query values: arrays are comma-joined, Dates become RFC 3339, undefined/null dropped. */
export function toQuery(params: Record<string, unknown> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    let s: string;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      s = v.join(",");
    } else if (v instanceof Date) s = v.toISOString();
    else s = String(v);
    qs.set(k, s);
  }
  const out = qs.toString();
  return out ? `?${out}` : "";
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** `AbortSignal.any` with a fallback for runtimes that lack it (Node 18). */
function anySignal(signals: AbortSignal[]): AbortSignal | undefined {
  if (signals.length <= 1) return signals[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      c.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => c.abort(s.reason), { once: true });
  }
  return c.signal;
}

function envKey(): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return p?.env?.HOTTUB_NEWS_API_KEY || undefined;
}

/**
 * Client for the Hottub News API. Zero dependencies; uses the global `fetch`.
 *
 * ```ts
 * const hn = new HottubNews();
 * const { items } = await hn.search("central bank rate decision", { since: "2d" });
 * ```
 */
export class HottubNews {
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  /** Webhook subscriptions. Require server support; return 404 until deployed. */
  readonly subscriptions: {
    create(req: SubscriptionRequest, opts?: RequestOptions): Promise<Subscription>;
    list(opts?: RequestOptions): Promise<{ subscriptions: Subscription[] }>;
    get(id: string, opts?: RequestOptions): Promise<Subscription>;
    delete(id: string, opts?: RequestOptions): Promise<unknown>;
  };

  constructor(options: HottubNewsOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? envKey();
    const f = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new Error("hottub-news: no global fetch; pass options.fetch");
    this.fetchImpl = (input, init) => f(input, init);
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.subscriptions = {
      create: (req, opts) => this.request<Subscription>("POST", "/v1/subscriptions", undefined, req, opts),
      list: (opts) => this.request("GET", "/v1/subscriptions", undefined, undefined, opts),
      get: (id, opts) => this.request("GET", `/v1/subscriptions/${encodeURIComponent(id)}`, undefined, undefined, opts),
      delete: (id, opts) => this.request("DELETE", `/v1/subscriptions/${encodeURIComponent(id)}`, undefined, undefined, opts),
    };
  }

  // ---- items -------------------------------------------------------------

  /** `GET /v1/items`: newest first by default; every filter in {@link ItemQuery}. */
  items(query: ItemQuery = {}, opts?: RequestOptions): Promise<ItemList> {
    return this.get<ItemList>("/v1/items", { ...query, format: "json" }, opts);
  }

  /** Search by meaning and keyword across languages. Results carry `score`. */
  search(q: string, query: Omit<ItemQuery, "q"> = {}, opts?: RequestOptions): Promise<ItemList> {
    return this.items({ ...query, q }, opts);
  }

  /** What everyone is covering: last 48h, one item per story, ranked by distinct outlets. */
  hot(query: ItemQuery = {}, opts?: RequestOptions): Promise<ItemList> {
    return this.items({ ...query, sort: "hot" }, opts);
  }

  /**
   * One page of the incremental feed: items with `seq > after`, oldest first.
   * Start with `after: 0` (or the `cursor` from {@link stats}) and store the returned `cursor`.
   */
  sync(query: ItemQuery & { after: number }, opts?: RequestOptions): Promise<ItemList> {
    return this.items(query, opts);
  }

  /**
   * Iterate the sync feed from `after`, page by page. Each item's `seq` is a resumable cursor.
   * With `follow: true` it keeps polling (every `pollMs`, default 60s) until `signal` aborts;
   * otherwise it stops when caught up.
   */
  async *syncAll(
    query: ItemQuery & { after?: number },
    opts: RequestOptions & { follow?: boolean; pollMs?: number } = {},
  ): AsyncGenerator<Item, number> {
    let after = query.after ?? 0;
    const limit = query.limit ?? 500;
    for (;;) {
      const page = await this.items({ ...query, after, limit }, opts);
      for (const item of page.items) yield item;
      const next = page.cursor ?? page.items.at(-1)?.seq ?? after;
      const caughtUp = page.items.length < limit || next <= after;
      after = next;
      if (caughtUp) {
        if (!opts.follow) return after;
        await sleep(opts.pollMs ?? 60_000, opts.signal);
      }
    }
  }

  /** Page through a browse/search result by following `next` (up to `maxPages`, default 10). */
  async *paginate(query: ItemQuery = {}, opts: RequestOptions & { maxPages?: number } = {}): AsyncGenerator<Item> {
    let page = await this.items(query, opts);
    for (let n = 1; ; n++) {
      for (const item of page.items) yield item;
      if (!page.next || n >= (opts.maxPages ?? 10) || page.items.length === 0) return;
      page = await this.getUrl<ItemList>(page.next, opts);
    }
  }

  /** The same query as {@link items}, in a text format (`md` and `lines` are cheapest for LLMs). */
  text(query: ItemQuery = {}, format: TextFormat = "md", opts?: RequestOptions): Promise<string> {
    return this.getText("/v1/items", { ...query, format }, opts);
  }

  /** `GET /v1/items/{id}`. */
  item(id: string, opts?: RequestOptions): Promise<Item> {
    return this.get<Item>(`/v1/items/${encodeURIComponent(id)}`, undefined, opts);
  }

  // ---- stories -----------------------------------------------------------

  /** `GET /v1/stories/{story}`: every report of one event across outlets and languages. */
  story(story: string, query: { limit?: number; [k: string]: unknown } = {}, opts?: RequestOptions): Promise<ItemList> {
    return this.get<ItemList>(`/v1/stories/${encodeURIComponent(story)}`, { ...query, format: "json" }, opts);
  }

  /** {@link story} in a text format. */
  storyText(story: string, format: TextFormat = "md", query: Record<string, unknown> = {}, opts?: RequestOptions): Promise<string> {
    return this.getText(`/v1/stories/${encodeURIComponent(story)}`, { ...query, format }, opts);
  }

  /** `GET /v1/stories`: top stories with briefs. Requires server support; 404 until deployed. */
  stories(query: StoriesQuery = {}, opts?: RequestOptions): Promise<StoryList> {
    return this.get<StoryList>("/v1/stories", { ...query, format: "json" }, opts);
  }

  /** `GET /v1/sections/{slug}`: a reader section ("save-money", "make-money", "entertainment"), matched by meaning across languages. */
  section(slug: SectionSlug, query: { limit?: number } = {}, opts?: RequestOptions): Promise<SectionPage> {
    return this.get<SectionPage>(`/v1/sections/${encodeURIComponent(slug)}`, query, opts);
  }

  // ---- reference ---------------------------------------------------------

  /** `GET /v1/sources`: registered sources with language, country, kind, terms and health. */
  sources(query: SourceQuery = {}, opts?: RequestOptions): Promise<SourceList> {
    return this.get<SourceList>("/v1/sources", { ...query, format: "json" }, opts);
  }

  /** `GET /v1/stats`: counts over the last 24h and the current sync cursor. */
  stats(opts?: RequestOptions): Promise<Stats> {
    return this.get<Stats>("/v1/stats", undefined, opts);
  }

  /** `GET /v1/entities?q=`: resolve names to Wikidata QIDs. Requires server support; 404 until deployed. */
  entities(q: string, query: { limit?: number; lang?: string; [k: string]: unknown } = {}, opts?: RequestOptions): Promise<EntityList> {
    return this.get<EntityList>("/v1/entities", { ...query, q }, opts);
  }

  // ---- placements (labeled, paid press releases) -------------------------

  /** `GET /v1/pricing`: the public rate card and formula. */
  pricing(opts?: RequestOptions): Promise<Record<string, unknown>> {
    return this.get("/v1/pricing", undefined, opts);
  }

  /** `GET /v1/pricing/quote`: an itemized quote for a labeled placement. */
  quote(query: QuoteQuery = {}, opts?: RequestOptions): Promise<Quote> {
    return this.get<Quote>("/v1/pricing/quote", { ...query }, opts);
  }

  /** `GET /v1/sponsored`: every running paid placement. */
  sponsored(opts?: RequestOptions): Promise<ItemList> {
    return this.get<ItemList>("/v1/sponsored", { format: "json" }, opts);
  }

  // ---- keys, stream ------------------------------------------------------

  /** `POST /v1/keys`: create an optional API key. Requires server support; 404 until deployed. */
  createKey(req: ApiKeyRequest = {}, opts?: RequestOptions): Promise<ApiKey> {
    return this.request<ApiKey>("POST", "/v1/keys", undefined, req, opts);
  }

  /**
   * `GET /v1/stream`: Server-Sent Events of new items matching the filters.
   * Parsed from the fetch body, so it works where `EventSource` doesn't (Node, Workers) and
   * can send the API key header. Requires server support; throws a 404 error until deployed.
   * Reconnects with `Last-Event-ID` when the connection drops, unless `reconnect: false`.
   */
  async *stream(
    query: ItemQuery = {},
    opts: RequestOptions & { reconnect?: boolean; lastEventId?: string } = {},
  ): AsyncGenerator<StreamEvent<Item | unknown>> {
    let lastId = opts.lastEventId;
    let retryMs = 3000;
    for (;;) {
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (lastId) headers["Last-Event-ID"] = lastId;
      const res = await this.send("GET", this.url("/v1/stream", query), headers, undefined, opts.signal, false);
      if (!res.body) throw new HottubNewsError("stream has no body", res.status, "no_body");
      try {
        for await (const ev of parseSSE(res.body, opts.signal)) {
          if (ev.id !== undefined) lastId = ev.id;
          if (ev.retry !== undefined) retryMs = ev.retry;
          yield ev;
        }
      } catch (err) {
        if (opts.signal?.aborted) return;
        if (opts.reconnect === false) throw err;
      }
      if (opts.signal?.aborted || opts.reconnect === false) return;
      await sleep(retryMs, opts.signal).catch(() => undefined);
      if (opts.signal?.aborted) return;
    }
  }

  // ---- transport ---------------------------------------------------------

  /** GET any API path and parse JSON. */
  get<T = unknown>(path: string, query?: Record<string, unknown>, opts?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, query, undefined, opts);
  }

  private getUrl<T>(absolute: string, opts?: RequestOptions): Promise<T> {
    return this.send("GET", absolute, { Accept: "application/json" }, undefined, opts?.signal).then((r) => r.json() as Promise<T>);
  }

  private async getText(path: string, query: Record<string, unknown>, opts?: RequestOptions): Promise<string> {
    const res = await this.send("GET", this.url(path, query), { Accept: "text/plain, */*" }, undefined, opts?.signal);
    return res.text();
  }

  /** Make any API request and parse the JSON response. */
  async request<T = unknown>(
    method: string,
    path: string,
    query?: Record<string, unknown>,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.send(method, this.url(path, query), headers, body === undefined ? undefined : JSON.stringify(body), opts?.signal);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private url(path: string, query?: Record<string, unknown>): string {
    return `${this.baseUrl}${path}${toQuery(query)}`;
  }

  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    signal: AbortSignal | undefined,
    timeout = true,
  ): Promise<Response> {
    const h: Record<string, string> = { ...headers, ...this.headers };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    for (let attempt = 0; ; attempt++) {
      const signals = [signal, timeout ? AbortSignal.timeout(this.timeoutMs) : undefined].filter(
        (s): s is AbortSignal => s !== undefined,
      );
      const s = anySignal(signals);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers: h, body, ...(s ? { signal: s } : {}) });
      } catch (err) {
        if (signal?.aborted || attempt >= this.maxRetries) {
          throw new HottubNewsError(`request failed: ${(err as Error)?.message ?? err}`, 0, "network_error", err);
        }
        await sleep(500 * 2 ** attempt, signal);
        continue;
      }
      if (res.ok) return res;
      const ra = res.headers.get("retry-after");
      const retryAfter = ra && /^\d+(\.\d+)?$/.test(ra) ? Number(ra) : undefined;
      if ([429, 502, 503, 504].includes(res.status) && attempt < this.maxRetries) {
        await res.body?.cancel().catch(() => {});
        await sleep(Math.min((retryAfter ?? 2 ** attempt) * 1000, 60_000), signal);
        continue;
      }
      const text = await res.text().catch(() => "");
      let parsed: unknown = text;
      let code = `http_${res.status}`;
      let message = text.slice(0, 300) || res.statusText || `HTTP ${res.status}`;
      try {
        parsed = JSON.parse(text);
        const e = (parsed as { error?: { code?: string; message?: string } }).error;
        if (e?.code) code = e.code;
        if (e?.message) message = e.message;
      } catch {
        // not JSON
      }
      throw new HottubNewsError(`${res.status} ${code}: ${message}`, res.status, code, parsed, retryAfter);
    }
  }
}
