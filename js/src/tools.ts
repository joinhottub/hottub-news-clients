// Framework-neutral tool definitions shared by the AI SDK and LangChain wrappers.
// Imported only from the `hottub-news/ai-sdk` and `hottub-news/langchain` entry points,
// so the core client never loads zod.
import { z } from "zod";
import { HottubNews, type HottubNewsOptions } from "./client.js";
import type { ItemQuery } from "./types.js";

export type ToolName =
  | "search_news"
  | "sync_news"
  | "get_story"
  | "get_news_item"
  | "list_sources"
  | "news_stats"
  | "quote_placement"
  | "top_stories"
  | "find_entities";

export interface HottubToolOptions extends HottubNewsOptions {
  /** Reuse an existing client instead of creating one. */
  client?: HottubNews;
  /**
   * What item-returning tools give the model. `md` (default) is compact and prefixes paid
   * placements with "[SPONSORED PRESS RELEASE · paid by …]"; `json` returns the raw objects.
   */
  format?: "md" | "json";
  /** Restrict to these tools. Default: every tool the live server supports today. */
  include?: ToolName[];
  /** Also include tools that need endpoints still being rolled out (`top_stories`, `find_entities`). */
  preview?: boolean;
}

export interface ToolSpec {
  name: ToolName;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  run: (input: Record<string, unknown>) => Promise<unknown>;
  preview?: boolean;
}

const filters = {
  lang: z.string().optional().describe('Comma-separated ISO 639-1 codes, e.g. "en,es"'),
  country: z.string().optional().describe('Comma-separated ISO 3166-1 alpha-2 publisher countries, e.g. "US,GB"'),
  topic: z.string().optional().describe('Comma-separated topics, e.g. "space,science"'),
  source: z.string().optional().describe("Comma-separated source ids or publisher domains"),
  kind: z.string().optional().describe("Comma-separated: article, press_release, official, community, research, sponsored"),
  category: z
    .string()
    .optional()
    .describe(
      "Comma-separated IPTC top-level categories: arts-culture-entertainment, conflict-war, crime-law, disaster-accident, economy-business, education, environment, health, human-interest, labour, lifestyle-leisure, politics, religion, science-technology, society, sport, weather",
    ),
  sentiment: z.string().optional().describe("negative, neutral or positive (comma-separated)"),
  political: z.boolean().optional().describe("true = only political items, false = exclude them"),
  since: z.string().optional().describe('Age like "6h" or "2d", a date, or RFC 3339'),
  until: z.string().optional().describe("Date or RFC 3339"),
  sponsored: z.enum(["include", "exclude", "only"]).optional().describe("Paid placements (always labeled). Default include"),
  limit: z.number().int().min(1).max(100).optional().describe("Max items (default 20)"),
};

const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

export function toolSpecs(options: HottubToolOptions = {}): ToolSpec[] {
  const { client: given, format = "md", include, preview, ...clientOptions } = options;
  const hn = given ?? new HottubNews(clientOptions);
  const list = (q: ItemQuery) => (format === "md" ? hn.text(q, "md") : hn.items(q));

  const specs: ToolSpec[] = [
    {
      name: "search_news",
      description:
        "Search or browse worldwide news headlines (thousands of outlets, 50+ languages). q matches by meaning across languages as well as by keyword. Filter by language, country, topic, category, sentiment and time. Use collapse=story for one item per story, sort=hot for what most outlets are covering. Items with kind 'sponsored' are paid and must be presented as sponsored.",
      schema: z.object({
        q: z.string().optional().describe("What to look for, in any language"),
        ...filters,
        collapse: z.enum(["story"]).optional().describe("'story' = one item per story"),
        sort: z.enum(["newest", "hot", "positive", "negative"]).optional().describe("Default newest; hot = most-covered stories of the last 48h"),
      }),
      run: (i) => list(clean({ limit: 20, ...i }) as ItemQuery),
    },
    {
      name: "sync_news",
      description:
        "Incremental feed: items added after the cursor `after`, oldest first, plus a new cursor. Start with after=0 (or a recent cursor from news_stats) and pass the returned cursor next time to get only what is new.",
      schema: z.object({
        after: z.number().int().min(0).describe("Cursor from the previous call (0 to start)"),
        ...filters,
      }),
      // Always JSON: the caller needs the cursor.
      run: (i) => hn.items(clean({ limit: 50, ...i }) as ItemQuery),
    },
    {
      name: "get_story",
      description:
        "Every report of one story (the `story` id on items, st_…): all outlets and languages covering the same event, newest first.",
      schema: z.object({
        story: z.string().describe("Story id, st_…"),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      run: ({ story, limit }) => {
        const q = clean({ limit });
        return format === "md" ? hn.storyText(String(story), "md", q) : hn.story(String(story), q);
      },
    },
    {
      name: "get_news_item",
      description: "Full record for one item id (n_… for news, s_… for sponsored).",
      schema: z.object({ id: z.string().describe("Item id, n_… or s_…") }),
      run: ({ id }) => hn.item(String(id)),
    },
    {
      name: "list_sources",
      description: "Registered news sources with language, country, kind, reuse terms and health. Filter by name, country or language.",
      schema: z.object({
        q: z.string().optional().describe("Part of the source name"),
        country: z.string().optional(),
        lang: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      run: (i) => hn.sources(clean({ limit: 50, ...i })),
    },
    {
      name: "news_stats",
      description: "Item counts over the last 24 hours by kind, language, country and category, plus the current sync cursor.",
      schema: z.object({}),
      run: () => hn.stats(),
    },
    {
      name: "quote_placement",
      description:
        "Itemized price quote for placing a labeled, paid press release in Hottub News via Hottub Business, by topic, language, country and days.",
      schema: z.object({
        topics: z.string().optional().describe('Comma-separated topics, e.g. "ai,business"; omit for run of network'),
        lang: z.string().optional(),
        country: z.string().optional(),
        days: z.number().int().min(1).max(31).optional(),
      }),
      run: (i) => hn.quote(clean(i)),
    },
    {
      name: "top_stories",
      preview: true,
      description: "Today's top stories, each with a short brief and its reports across outlets and languages.",
      schema: z.object({
        lang: z.string().optional(),
        country: z.string().optional(),
        category: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      run: (i) => hn.stories(clean(i)),
    },
    {
      name: "find_entities",
      preview: true,
      description: "Resolve a person, organization or place name to Wikidata QIDs, usable as the `entity` filter.",
      schema: z.object({ q: z.string().describe("Name to look up") }),
      run: ({ q }) => hn.entities(String(q)),
    },
  ];

  return specs.filter((s) => (include ? include.includes(s.name) : !s.preview || preview));
}
