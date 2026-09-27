// Types for the Hottub News API (https://hottub.news/openapi.json).
// Empty fields are omitted by the server, never null, so most fields are optional.

export type Kind =
  | "article"
  | "press_release"
  | "official"
  | "community"
  | "research"
  | "sponsored";

export type Category =
  | "arts-culture-entertainment"
  | "conflict-war"
  | "crime-law"
  | "disaster-accident"
  | "economy-business"
  | "education"
  | "environment"
  | "health"
  | "human-interest"
  | "labour"
  | "lifestyle-leisure"
  | "politics"
  | "religion"
  | "science-technology"
  | "society"
  | "sport"
  | "weather";

export type Sentiment = "negative" | "neutral" | "positive";

/** Text formats the API can return in addition to `json`. */
export type TextFormat = "md" | "lines" | "ndjson" | "rss" | "jsonfeed";

export interface SourceRef {
  id: string;
  name: string;
  domain?: string;
}

export interface Disclosure {
  paid: true;
  label: string;
  campaign: string;
  sponsor: { id: string; name: string; url?: string; verified: boolean };
}

/** One news item (schema `hottub-news/item/v1`). */
export interface Item {
  /** `n_…` for news, `s_…` for paid (sponsored) placements. */
  id: string;
  /** Monotonic sync cursor. */
  seq?: number;
  kind: Kind;
  title: string;
  /** English translation of the title. Requires server support; absent until deployed. */
  title_en?: string;
  url: string;
  summary?: string;
  published: string;
  seen: string;
  lang?: string;
  country?: string;
  source: SourceRef;
  via: string;
  topics?: string[];
  authors?: string[];
  image?: string;
  mentions?: number;
  /** `st_…`: shared by every report of the same event, across outlets and languages. */
  story?: string;
  related?: number;
  score?: number;
  category?: Category;
  category_p?: number;
  category2?: Category;
  sentiment?: Sentiment;
  tone?: number;
  political?: number;
  /** Wikidata entities mentioned. Requires server support; absent until deployed. */
  entities?: Entity[];
  /** Present if and only if `kind === "sponsored"`. */
  disclosure?: Disclosure;
  [extra: string]: unknown;
}

/** A page of items (schema `hottub-news/list/v1`). */
export interface ItemList {
  schema: string;
  item_schema?: string;
  count: number;
  /** Sync cursor (present when `after` was given). Pass it back as `after`. */
  cursor?: number;
  /** URL of the next page, when there is one. */
  next?: string;
  /** Number of sponsored items on this page. */
  sponsored: number;
  items: Item[];
  [extra: string]: unknown;
}

/** A list value: arrays are joined with commas. */
export type Multi = string | readonly string[];
/** A time value: RFC 3339, a date, unix seconds, an age like `6h`, or a Date. */
export type TimeLike = string | number | Date;

export interface ItemQuery {
  /** Search by meaning and keyword, in any language. */
  q?: string;
  lang?: Multi;
  country?: Multi;
  topic?: Multi;
  /** Source ids or publisher domains. */
  source?: Multi;
  kind?: Kind | readonly Kind[] | string;
  /** Wikidata QIDs such as `Q312`. Requires server support; ignored or 400 until deployed. */
  entity?: Multi;
  since?: TimeLike;
  until?: TimeLike;
  /** Sync cursor: items with `seq > after`, oldest first. */
  after?: number;
  /** Paging cursor taken from `next`. */
  before?: string;
  /** 1..500, default 50. */
  limit?: number;
  sponsored?: "include" | "exclude" | "only";
  category?: Category | readonly Category[] | string;
  sentiment?: Sentiment | readonly Sentiment[] | string;
  political?: boolean;
  tone_min?: number;
  tone_max?: number;
  match?: "hybrid" | "keyword" | "semantic";
  collapse?: "story";
  per_source?: number;
  sort?: "newest" | "hot" | "positive" | "negative";
  /** Any other query parameter the server accepts. */
  [extra: string]: unknown;
}

export interface SourceHealth {
  ok: boolean;
  last_ok?: string | null;
  last_status?: number | null;
  last_error?: string | null;
  last_new?: number;
  items_total?: number;
}

export interface Source {
  id: string;
  name: string;
  kind: Kind;
  aggregator?: boolean;
  lang?: string;
  country?: string;
  topics?: string[];
  homepage?: string;
  every_min?: number;
  /** The publisher's terms for reuse. Respect them. */
  terms?: string;
  requires?: string[];
  health?: SourceHealth;
  [extra: string]: unknown;
}

export interface SourceList {
  schema: string;
  total: number;
  offset: number;
  count: number;
  next?: string;
  sources: Source[];
  [extra: string]: unknown;
}

export interface SourceQuery {
  q?: string;
  country?: Multi;
  lang?: Multi;
  limit?: number;
  offset?: number;
  [extra: string]: unknown;
}

export interface Stats {
  schema: string;
  items: number;
  cursor: number;
  oldest?: string;
  sources?: { enabled: number; healthy: number; failing: number };
  last_24h: Record<string, Record<string, number>>;
  [extra: string]: unknown;
}

export interface QuoteQuery {
  topics?: Multi;
  lang?: Multi;
  country?: Multi;
  /** 1..31, default 7. */
  days?: number;
  starts?: TimeLike;
}

export interface Quote {
  schema: string;
  currency: string;
  day_cents: number;
  days: number;
  total_cents: number;
  priced_topic?: string;
  lines: { factor: string; value: number; why: string }[];
  quote_id?: string;
  [extra: string]: unknown;
}

/** A Wikidata entity. Requires server support. */
export interface Entity {
  /** Wikidata QID, e.g. `Q312`. */
  id: string;
  label?: string;
  description?: string;
  [extra: string]: unknown;
}

export interface EntityList {
  schema?: string;
  entities: Entity[];
  [extra: string]: unknown;
}

/** A top story with a brief. Requires server support (`GET /v1/stories`). */
export interface Story {
  story: string;
  title?: string;
  brief?: string;
  items?: Item[];
  [extra: string]: unknown;
}

export interface StoryList {
  schema?: string;
  stories: Story[];
  [extra: string]: unknown;
}

export interface StoriesQuery {
  lang?: Multi;
  country?: Multi;
  category?: Multi;
  since?: TimeLike;
  limit?: number;
  [extra: string]: unknown;
}

export interface ApiKeyRequest {
  name?: string;
  email?: string;
  [extra: string]: unknown;
}

export interface ApiKey {
  /** `hn_…`. Shown once; store it. */
  key: string;
  [extra: string]: unknown;
}

export interface SubscriptionRequest {
  /** HTTPS URL that receives POSTed items. */
  webhook: string;
  /** The same filters as `/v1/items` (q, lang, country, topic, entity, ...). */
  filter?: ItemQuery;
  [extra: string]: unknown;
}

export interface Subscription {
  id: string;
  webhook?: string;
  [extra: string]: unknown;
}

/** One Server-Sent Event. `data` is parsed as JSON when possible. */
export interface StreamEvent<T = unknown> {
  event: string;
  data: T;
  id?: string;
  retry?: number;
}

export type SectionSlug = "save-money" | "make-money" | "entertainment" | (string & {});

/** `GET /v1/sections/{slug}` */
export interface SectionPage {
  section: string;
  name: string;
  description: string;
  page: string;
  items: Item[];
}
