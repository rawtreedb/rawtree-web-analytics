// All dashboard SQL in one place, so the recipes and the agent can reuse it.
// Every count deduplicates: delivery is at least once, so a resent event can store the
// same `event_id` twice. Counting queries use `uniqExact(toString(event_id))`; the
// recording list deduplicates chunk parts by `chunk_id` before aggregating.

import { planFetch, reassemble, type ChunkMetadata, type ChunkRow, type RecordingGap } from "./reassembly.ts";

export type QueryConfig = {
  apiUrl: string;
  database: string;
  queryKey: string;
  /** Prefix for table names, e.g. "e2e_" for disposable test tables. Empty in production. */
  tablePrefix: string;
};

export function loadQueryConfig(env: Record<string, string | undefined> = process.env): QueryConfig {
  const missing = ["RAWTREE_API_URL", "RAWTREE_DATABASE", "RAWTREE_QUERY_KEY"].filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Dashboard is missing configuration: ${missing.join(", ")}`);
  return {
    apiUrl: (env.RAWTREE_API_URL ?? "").replace(/\/$/, ""),
    database: env.RAWTREE_DATABASE ?? "",
    queryKey: env.RAWTREE_QUERY_KEY ?? "",
    tablePrefix: env.RAWTREE_TABLE_PREFIX ?? "",
  };
}

export class DashboardQueryError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Run one read statement with the read-only key and return its rows. */
export async function runQuery(
  config: QueryConfig,
  sql: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const response = await fetchImpl(`${config.apiUrl}/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.queryKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, database: config.database }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new DashboardQueryError(`RawTree query failed: ${text.slice(0, 300)}`, response.status);
  }
  const result = JSON.parse(text) as { data?: unknown };
  return Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
}

/** The `events` table for this deployment (prefix-aware). */
export function eventsTable(config: QueryConfig): string {
  return `${config.tablePrefix}events`;
}

/** The `recordings` table for this deployment (prefix-aware). */
export function recordingsTable(config: QueryConfig): string {
  return `${config.tablePrefix}recordings`;
}

// --- Date range ----------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Treewatcher's reporting-window presets, in picker order. */
export const RANGE_PRESETS = {
  today: "Today",
  this_week: "This week",
  last_week: "Last week",
  last_7_days: "Last 7 days",
  last_28_days: "Last 28 days",
  last_90_days: "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
} as const;

export type RangeKey = keyof typeof RANGE_PRESETS;

export type ResolvedRange = OverviewRange & {
  /** The preset used, or "custom" when explicit start/end timestamps were given. */
  key: RangeKey | "custom";
  label: string;
  fromMs: number;
  toMs: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

/** The subset of Next.js page `searchParams` this module reads. */
export type SearchParamsLike = SearchParams;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** [from, to) in ms for a preset. Weeks start on Monday; everything is UTC. */
function presetWindow(key: RangeKey, nowMs: number): [number, number] {
  const now = new Date(nowMs);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const week = today - ((now.getUTCDay() + 6) % 7) * DAY_MS;
  const month = (offset: number) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1);
  switch (key) {
    case "today": return [today, nowMs];
    case "this_week": return [week, nowMs];
    case "last_week": return [week - 7 * DAY_MS, week];
    // ponytail: "Last N days" runs through now (today included), unlike Treewatcher's full days,
    // so fresh analytics show up; switch to [today - N days, today) if full days matter more.
    case "last_7_days": return [today - 6 * DAY_MS, nowMs];
    case "last_28_days": return [today - 27 * DAY_MS, nowMs];
    case "last_90_days": return [today - 89 * DAY_MS, nowMs];
    case "this_month": return [month(0), nowMs];
    case "last_month": return [month(-1), month(0)];
  }
}

/**
 * Resolve the `range` preset, or `range=custom` with ISO `start`/`end` timestamps (`end`
 * exclusive, at most 366 days), from page search params. Falls back to the last 7 days.
 */
export function resolveRange(params: SearchParams, nowMs = Date.now()): ResolvedRange {
  const range = firstParam(params.range);
  if (range === "custom") {
    const fromMs = Date.parse(firstParam(params.start) ?? "");
    const toMs = Math.min(Date.parse(firstParam(params.end) ?? ""), nowMs);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs && toMs - fromMs <= 366 * DAY_MS) {
      return { key: "custom", label: "Custom range", fromMs, toMs };
    }
  }
  const key = range && range in RANGE_PRESETS ? (range as RangeKey) : "last_7_days";
  const [fromMs, toMs] = presetWindow(key, nowMs);
  return { key, label: RANGE_PRESETS[key], fromMs, toMs };
}

// --- Overview -----------------------------------------------------------------

export type OverviewRange = { fromMs: number; toMs: number };

function eventsWhere(range: OverviewRange): string {
  return `CAST(occurred_at_ms AS Int64) >= ${range.fromMs}\n  AND CAST(occurred_at_ms AS Int64) < ${range.toMs}`;
}

// --- Bot detection in SQL -------------------------------------------------------

/**
 * Broad crawler/user-agent pattern for splitting human and bot traffic in SQL, kept in
 * step with lib/crawlers.ts (which classifies exact agents for the Bots breakdown).
 * The exact-agent classifier stays the source of truth for the crawler tables; this
 * predicate only has to draw the same human/bot line for aggregate counts.
 */
export const BOT_UA_PATTERN =
  "bot|crawl|spider|slurp|headless|puppeteer|playwright|phantom|curl/|wget|python|go-http|node-fetch|axios|undici|httpx|scrapy|" +
  "facebookexternalhit|slack|whatsapp|chatgpt-user|perplexity|claude-|mistralai|cohere-ai|anthropic-ai|exa.ai|google-extended|" +
  "googleother|google-inspectiontool|externalagent|meta-webindexer|bingpreview|yandex|sogou|ahrefs|semrush|barkrowler|screaming frog|aiohttp";

/** The same human/bot line in JavaScript, for folding per-user-agent rows. */
export function isBotUa(userAgent: string): boolean {
  return new RegExp(BOT_UA_PATTERN).test(userAgent.toLowerCase());
}

export function isBotUaSql(expression: string): string {
  return `match(lower(${expression}), '${BOT_UA_PATTERN}')`;
}

export function botUaSql(): string {
  return isBotUaSql("coalesce(toString(user_agent), '')");
}

/** Headline totals for the range (no user agent reference: these work on any deployment). */
export function overviewSummarySql(config: QueryConfig, range: OverviewRange): string {
  return `SELECT
  uniqExact(toString(event_id)) AS events,
  uniqExact(toString(session_id)) AS sessions,
  uniqExact(toString(anonymous_id)) AS visitors,
  uniqExactIf(toString(event_id), toString(event_name) = 'page_view') AS page_views
FROM ${eventsTable(config)}
WHERE ${eventsWhere(range)}`;
}

/** Top pages, counted from `page_view` events only (humans only, like every content metric). */
export function topPagesSql(config: QueryConfig, range: OverviewRange, limit = 10, humanOnly = true): string {
  return `SELECT
  toString(page_path) AS path,
  uniqExact(toString(event_id)) AS page_views,
  uniqExact(toString(anonymous_id)) AS visitors
FROM ${eventsTable(config)}
WHERE ${humanOnly ? `${eventsWhere(range)}\n  AND NOT ${botUaSql()}` : eventsWhere(range)}
  AND toString(event_name) = 'page_view'
GROUP BY path
ORDER BY page_views DESC, path ASC
LIMIT ${limit}`;
}

// --- Section queries: Traffic, Acquisition, Content, Engagement, Bots -------------
// Every count deduplicates on event_id; page-view-level metrics deduplicate on the
// page_view_id the console recipes send. Aggregates by exact user agent are classified
// in JavaScript (lib/crawlers.ts) so the SQL stays portable.

/** Daily trend rows per UTC day and user agent; folded into human/bot buckets in JavaScript. */
export function dailyTrendSql(config: QueryConfig, range: OverviewRange, withUserAgent = true): string {
  return `SELECT
  toUnixTimestamp(toStartOfDay(toDateTime(CAST(occurred_at_ms AS Int64) / 1000, 'UTC'))) * 1000 AS day_ms,
  ${withUserAgent ? botUaSql() : "0"} AS is_bot,
  uniqExact(toString(event_id)) AS events,
  uniqExactIf(toString(event_id), toString(event_name) = 'page_view') AS page_views,
  uniqExactIf(toString(session_id), toString(session_id) != '') AS sessions,
  uniqExactIf(toString(anonymous_id), toString(anonymous_id) != '') AS visitors
FROM ${eventsTable(config)}
WHERE ${eventsWhere(range)}
GROUP BY day_ms, is_bot
ORDER BY day_ms ASC`;
}

export type TrendRow = {
  dayMs: number;
  events: number;
  pageViews: number;
  sessions: number;
  visitors: number;
  botEvents: number;
  botPageViews: number;
};

export function extractDailyTrend(rows: Record<string, unknown>[]): TrendRow[] {
  const byDay = new Map<number, TrendRow>();
  for (const row of rows) {
    const dayMs = asNumber(row.day_ms);
    const bot = bool(row.is_bot);
    const entry =
      byDay.get(dayMs) ?? { dayMs, events: 0, pageViews: 0, sessions: 0, visitors: 0, botEvents: 0, botPageViews: 0 };
    // A session or visitor is counted in the bucket of the user agent it came with;
    // mixed-UIA sessions are rare and attributed to both sides at most.
    if (bot) {
      entry.botEvents += asNumber(row.events);
      entry.botPageViews += asNumber(row.page_views);
    } else {
      entry.events += asNumber(row.events);
      entry.pageViews += asNumber(row.page_views);
      entry.sessions += asNumber(row.sessions);
      entry.visitors += asNumber(row.visitors);
    }
    byDay.set(dayMs, entry);
  }
  return [...byDay.values()].sort((a, b) => a.dayMs - b.dayMs);
}

/** Per-user-agent aggregates for bot traffic only (so the limit never drops crawlers behind browser versions). */
export function uaBreakdownSql(config: QueryConfig, range: OverviewRange, limit = 500): string {
  return `SELECT
  coalesce(toString(user_agent), '') AS ua,
  uniqExact(toString(event_id)) AS events,
  uniqExactIf(toString(event_id), toString(event_name) = 'page_view') AS page_views,
  uniqExactIf(toString(session_id), toString(session_id) != '') AS sessions,
  uniqExactIf(toString(anonymous_id), toString(anonymous_id) != '') AS visitors
FROM ${eventsTable(config)}
WHERE ${eventsWhere(range)} AND ${botUaSql()}
GROUP BY ua
ORDER BY events DESC
LIMIT ${limit}`;
}

export type UaGroup = { userAgent: string; events: number; pageViews: number; sessions: number; visitors: number };

export function extractUaGroups(rows: Record<string, unknown>[]): UaGroup[] {
  return rows.map((row) => ({
    userAgent: asString(row.ua),
    events: asNumber(row.events),
    pageViews: asNumber(row.page_views),
    sessions: asNumber(row.sessions),
    visitors: asNumber(row.visitors),
  }));
}

/**
 * First-touch attribution: one row per session with the referrer and page URL of its
 * earliest event. Channels, referrer hosts, and UTM tags are derived in JavaScript.
 */
export function sessionFirstTouchSql(config: QueryConfig, range: OverviewRange, limit = 5000, humanOnly = true): string {
  return `SELECT
  toString(session_id) AS session_id,
  argMin(coalesce(toString(referrer), ''), CAST(occurred_at_ms AS Int64)) AS first_referrer,
  argMin(coalesce(toString(page_url), ''), CAST(occurred_at_ms AS Int64)) AS first_page_url,
  uniqExact(toString(anonymous_id)) AS visitors
FROM ${eventsTable(config)}
WHERE ${eventsWhere(range)} AND toString(session_id) != ''${humanOnly ? `\n  AND NOT ${botUaSql()}` : ""}
GROUP BY session_id
LIMIT ${limit}`;
}

export type FirstTouchSession = { sessionId: string; referrer: string; pageUrl: string };

export function extractFirstTouch(rows: Record<string, unknown>[]): FirstTouchSession[] {
  return rows.map((row) => ({
    sessionId: asString(row.session_id),
    referrer: asString(row.first_referrer),
    pageUrl: asString(row.first_page_url),
  }));
}

/** Top pages among bot page views. */
export function botPathsSql(config: QueryConfig, range: OverviewRange, limit = 10): string {
  return `SELECT
  coalesce(nullIf(toString(page_path), ''), '(unknown)') AS path,
  uniqExact(toString(event_id)) AS requests
FROM ${eventsTable(config)}
WHERE ${eventsWhere(range)} AND ${botUaSql()} AND toString(event_name) = 'page_view'
GROUP BY path
ORDER BY requests DESC, path ASC
LIMIT ${limit}`;
}

/** Per-path time-on-page quantiles over deduplicated page views (one row per page_view_id). */
export function timeOnPageSql(config: QueryConfig, range: OverviewRange, limit = 50): string {
  return `SELECT
  path,
  uniqExact(pv) AS views,
  round(quantile(0.5)(ms)) AS median_ms,
  round(quantile(0.75)(ms)) AS p75_ms,
  countIf(ms >= 10000) AS engaged_views,
  countIf(ms < 5000) AS quick_exits
FROM
(
  SELECT
    toString(properties.page_view_id) AS pv,
    argMax(coalesce(nullIf(toString(properties.path), ''), '(unknown)'), CAST(occurred_at_ms AS Int64)) AS path,
    max(CAST(properties.elapsed_ms AS Int64)) AS ms
  FROM ${eventsTable(config)}
  WHERE ${eventsWhere(range)} AND toString(event_name) = 'time_on_page'
  GROUP BY pv
)
GROUP BY path
ORDER BY views DESC, path ASC
LIMIT ${limit}`;
}

export type TimeOnPageRow = {
  path: string;
  views: number;
  medianMs: number;
  p75Ms: number;
  engagedViews: number;
  quickExits: number;
};

export function extractTimeOnPage(rows: Record<string, unknown>[]): TimeOnPageRow[] {
  return rows.map((row) => ({
    path: asString(row.path),
    views: asNumber(row.views),
    medianMs: asNumber(row.median_ms),
    p75Ms: asNumber(row.p75_ms),
    engagedViews: asNumber(row.engaged_views),
    quickExits: asNumber(row.quick_exits),
  }));
}

/** Overall time-on-page quantiles (no path grouping), for the Engagement stat cards. */
export function timeOnPageTotalsSql(config: QueryConfig, range: OverviewRange): string {
  return `SELECT
  uniqExact(pv) AS views,
  round(quantile(0.5)(ms)) AS median_ms,
  round(quantile(0.75)(ms)) AS p75_ms,
  countIf(ms >= 10000) AS engaged_views,
  countIf(ms < 5000) AS quick_exits
FROM
(
  SELECT
    toString(properties.page_view_id) AS pv,
    max(CAST(properties.elapsed_ms AS Int64)) AS ms
  FROM ${eventsTable(config)}
  WHERE ${eventsWhere(range)} AND toString(event_name) = 'time_on_page'
  GROUP BY pv
)`;
}

/** Share of page views per path reaching each scroll threshold, over deduplicated page views. */
export function scrollDepthSql(config: QueryConfig, range: OverviewRange, limit = 50): string {
  return `SELECT
  path,
  uniqExact(pv) AS views,
  round(countIf(max_threshold >= 25) / count(), 4) AS reached_25,
  round(countIf(max_threshold >= 50) / count(), 4) AS reached_50,
  round(countIf(max_threshold >= 75) / count(), 4) AS reached_75,
  round(countIf(max_threshold >= 100) / count(), 4) AS reached_100
FROM
(
  SELECT
    toString(properties.page_view_id) AS pv,
    argMax(coalesce(nullIf(toString(properties.path), ''), '(unknown)'), CAST(occurred_at_ms AS Int64)) AS path,
    max(CAST(properties.threshold AS Int64)) AS max_threshold
  FROM ${eventsTable(config)}
  WHERE ${eventsWhere(range)} AND toString(event_name) = 'scroll_depth'
  GROUP BY pv
)
GROUP BY path
ORDER BY views DESC, path ASC
LIMIT ${limit}`;
}

export type ScrollRow = {
  path: string;
  views: number;
  reached25: number;
  reached50: number;
  reached75: number;
  reached100: number;
};

export function extractScrollDepth(rows: Record<string, unknown>[]): ScrollRow[] {
  return rows.map((row) => ({
    path: asString(row.path),
    views: asNumber(row.views),
    reached25: asNumber(row.reached_25),
    reached50: asNumber(row.reached_50),
    reached75: asNumber(row.reached_75),
    reached100: asNumber(row.reached_100),
  }));
}

/** Top CTA clicks grouped by id and placement. */
export function ctaClicksSql(config: QueryConfig, range: OverviewRange, limit = 10): string {
  return `SELECT
  toString(properties.cta_id) AS cta_id,
  toString(properties.placement) AS placement,
  uniqExact(toString(event_id)) AS clicks
FROM ${eventsTable(config)}
WHERE ${eventsWhere(range)} AND toString(event_name) = 'cta_click'
GROUP BY cta_id, placement
ORDER BY clicks DESC, cta_id ASC
LIMIT ${limit}`;
}

export type CtaRow = { ctaId: string; placement: string; clicks: number };

export function extractCtaClicks(rows: Record<string, unknown>[]): CtaRow[] {
  return rows.map((row) => ({ ctaId: asString(row.cta_id), placement: asString(row.placement), clicks: asNumber(row.clicks) }));
}

export type BaseTotals = { events: number; sessions: number; visitors: number; pageViews: number };
export type BotSplit = { humanEvents: number; humanSessions: number; humanVisitors: number; humanPageViews: number };

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export function extractSummary(row: Record<string, unknown> | undefined): BaseTotals {
  return {
    events: asNumber(row?.events),
    sessions: asNumber(row?.sessions),
    visitors: asNumber(row?.visitors),
    pageViews: asNumber(row?.page_views),
  };
}

export function extractBotSplit(row: Record<string, unknown> | undefined): BotSplit {
  return {
    humanEvents: asNumber(row?.human_events),
    humanSessions: asNumber(row?.human_sessions),
    humanVisitors: asNumber(row?.human_visitors),
    humanPageViews: asNumber(row?.human_page_views),
  };
}

/** The equal-length window immediately before the selected one. */
export function previousRange(range: OverviewRange): OverviewRange {
  const length = range.toMs - range.fromMs;
  return { fromMs: range.fromMs - length, toMs: range.fromMs };
}

export function extractTopPages(rows: Record<string, unknown>[]): { path: string; pageViews: number; visitors: number }[] {
  return rows.map((row) => ({ path: asString(row.path), pageViews: asNumber(row.page_views), visitors: asNumber(row.visitors) }));
}

/** Human/bot split of the headline totals; needs the user_agent column to exist. */
export function botSplitSql(config: QueryConfig, range: OverviewRange): string {
  const bot = botUaSql();
  return `SELECT
  uniqExactIf(toString(event_id), NOT ${bot}) AS human_events,
  uniqExactIf(toString(session_id), toString(session_id) != '' AND NOT ${bot}) AS human_sessions,
  uniqExactIf(toString(anonymous_id), toString(anonymous_id) != '' AND NOT ${bot}) AS human_visitors,
  uniqExactIf(toString(event_id), toString(event_name) = 'page_view' AND NOT ${bot}) AS human_page_views
FROM ${eventsTable(config)}
WHERE ${eventsWhere(range)}`;
}

// --- Acquisition folding (JavaScript side of first-touch attribution) ------------

const SEARCH_HOSTS = new Set(["google.", "bing.", "duckduckgo.", "yahoo.", "ecosia.", "search.brave.", "yandex.", "baidu."]);
const SOCIAL_HOSTS = new Set(["facebook.", "t.co", "twitter.", "x.com", "linkedin.", "instagram.", "reddit.", "youtube.", "tiktok.", "bsky.", "mastodon."]);
const MAIL_HOSTS = new Set(["mail.", "outlook.", "gmail.", "proton."]);

/** First-touch channel class for a referrer: Direct, Search, Social, Mail, or Referral. */
export function channelOf(referrer: string): string {
  if (!referrer) return "Direct";
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "Referral";
  }
  const starts = (prefixes: Set<string>) => [...prefixes].some((prefix) => host.startsWith(prefix) || host.includes(`.${prefix}`));
  if (starts(SEARCH_HOSTS)) return "Search";
  if (starts(SOCIAL_HOSTS)) return "Social";
  if (starts(MAIL_HOSTS)) return "Mail";
  return "Referral";
}

/** Referrer host label: the hostname without www, or "Direct" for empty referrers. */
export function referrerHostOf(referrer: string): string {
  if (!referrer) return "Direct";
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "Referral";
  }
}

export type Utm = { source?: string; medium?: string; campaign?: string };

/** UTM tags carried by a first-touch page URL. */
export function utmOf(pageUrl: string): Utm {
  if (!pageUrl) return {};
  try {
    const params = new URL(pageUrl).searchParams;
    const source = params.get("utm_source") ?? undefined;
    const medium = params.get("utm_medium") ?? undefined;
    const campaign = params.get("utm_campaign") ?? undefined;
    return { source, medium, campaign };
  } catch {
    return {};
  }
}

export type ChannelRow = { label: string; sessions: number };
export type ReferrerRow = { label: string; sessions: number; channel: string };
export type CampaignRow = { source: string; medium: string; campaign: string; sessions: number };

export function sessionsByChannel(sessions: FirstTouchSession[]): ChannelRow[] {
  const counts = new Map<string, number>();
  for (const session of sessions) counts.set(channelOf(session.referrer), (counts.get(channelOf(session.referrer)) ?? 0) + 1);
  return [...counts.entries()].map(([label, sessions]) => ({ label, sessions })).sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));
}

export function sessionsByReferrer(sessions: FirstTouchSession[]): ReferrerRow[] {
  const counts = new Map<string, { sessions: number; channel: string }>();
  for (const session of sessions) {
    const label = referrerHostOf(session.referrer);
    const entry = counts.get(label) ?? { sessions: 0, channel: channelOf(session.referrer) };
    entry.sessions += 1;
    counts.set(label, entry);
  }
  return [...counts.entries()].map(([label, entry]) => ({ label, sessions: entry.sessions, channel: entry.channel })).sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));
}

export function campaignRows(sessions: FirstTouchSession[]): CampaignRow[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const utm = utmOf(session.pageUrl);
    if (!utm.source && !utm.medium && !utm.campaign) continue;
    const key = `${utm.source ?? ""}\u0000${utm.medium ?? ""}\u0000${utm.campaign ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, sessions]) => {
      const [source, medium, campaign] = key.split("\u0000");
      return { source: source || "(none)", medium: medium || "(none)", campaign: campaign || "(none)", sessions };
    })
    .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source));
}

// --- Dashboard assembly ----------------------------------------------------------

/**
 * Run a query builder twice: first with the human-only filter, then without when the
 * user_agent column does not exist yet (a deployment that has not stored a user agent).
 */
async function runQueryWithBotFallback(
  config: QueryConfig,
  build: (humanOnly: boolean) => string,
  fetchImpl?: typeof fetch,
): Promise<Record<string, unknown>[]> {
  try {
    return await runQuery(config, build(true), fetchImpl);
  } catch (error) {
    if (error instanceof DashboardQueryError && /unknown (expression or function )?identifier/i.test(error.message)) {
      return runQuery(config, build(false), fetchImpl);
    }
    throw error;
  }
}

/** Run one query, returning null when a column it needs has never been stored. */
async function runQueryOptional(
  config: QueryConfig,
  sql: string,
  fetchImpl?: typeof fetch,
): Promise<Record<string, unknown>[] | null> {
  try {
    return await runQuery(config, sql, fetchImpl);
  } catch (error) {
    if (error instanceof DashboardQueryError && /unknown (expression or function )?identifier/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

export type DashboardData = {
  current: BaseTotals;
  previous: BaseTotals;
  /** Null when the user_agent column has never been stored: human/bot views stay empty. */
  botSplit: BotSplit | null;
  previousBotSplit: BotSplit | null;
  daily: TrendRow[];
  previousDaily: TrendRow[];
  uaGroups: UaGroup[] | null;
  firstTouch: FirstTouchSession[] | null;
  topPaths: { path: string; pageViews: number; visitors: number }[];
  previousTopPaths: { path: string; pageViews: number; visitors: number }[];
  timeOnPage: TimeOnPageRow[];
  timeTotals: { views: number; medianMs: number; p75Ms: number; engagedViews: number; quickExits: number } | null;
  scroll: ScrollRow[];
  ctas: CtaRow[];
  botPaths: { path: string; requests: number }[] | null;
};

/** Every dashboard section for one window and its previous period, queried in parallel. */
export async function getDashboard(config: QueryConfig, range: OverviewRange, fetchImpl?: typeof fetch): Promise<DashboardData> {
  const previous = previousRange(range);
  const [summaryRows, previousSummaryRows, botSplitRow, previousBotSplitRow, dailyRows, previousDailyRows, uaRows, firstTouchRows, topPathRows, previousTopPathRows, timeRows, timeTotalRows, scrollRows, ctaRows, botPathRows] =
    await Promise.all([
      runQuery(config, overviewSummarySql(config, range), fetchImpl),
      runQuery(config, overviewSummarySql(config, previous), fetchImpl),
      runQueryOptional(config, botSplitSql(config, range), fetchImpl).then((rows) => rows?.[0] ?? null),
      runQueryOptional(config, botSplitSql(config, previous), fetchImpl).then((rows) => rows?.[0] ?? null),
      runQueryWithBotFallback(config, (ua) => dailyTrendSql(config, range, ua), fetchImpl),
      runQueryWithBotFallback(config, (ua) => dailyTrendSql(config, previous, ua), fetchImpl),
      runQueryOptional(config, uaBreakdownSql(config, range), fetchImpl),
      // Humans only when user agents exist; null when no referrer has ever been stored.
      runQueryWithBotFallback(config, (human) => sessionFirstTouchSql(config, range, 5000, human), fetchImpl).catch((error: unknown) => {
        if (error instanceof DashboardQueryError && /unknown (expression or function )?identifier/i.test(error.message)) return null;
        throw error;
      }),
      runQueryWithBotFallback(config, (human) => topPagesSql(config, range, 50, human), fetchImpl),
      runQueryWithBotFallback(config, (human) => topPagesSql(config, previous, 50, human), fetchImpl),
      runQuery(config, timeOnPageSql(config, range), fetchImpl),
      runQueryOptional(config, timeOnPageTotalsSql(config, range), fetchImpl).then((rows) => rows?.[0] ?? null),
      runQuery(config, scrollDepthSql(config, range), fetchImpl),
      runQuery(config, ctaClicksSql(config, range), fetchImpl),
      runQueryOptional(config, botPathsSql(config, range), fetchImpl),
    ]);

  return {
    current: extractSummary(summaryRows[0]),
    previous: extractSummary(previousSummaryRows[0]),
    botSplit: botSplitRow ? extractBotSplit(botSplitRow) : null,
    previousBotSplit: previousBotSplitRow ? extractBotSplit(previousBotSplitRow) : null,
    daily: extractDailyTrend(dailyRows),
    previousDaily: extractDailyTrend(previousDailyRows),
    uaGroups: uaRows === null ? null : extractUaGroups(uaRows),
    firstTouch: firstTouchRows === null ? null : extractFirstTouch(firstTouchRows),
    topPaths: extractTopPages(topPathRows),
    previousTopPaths: extractTopPages(previousTopPathRows),
    timeOnPage: extractTimeOnPage(timeRows),
    timeTotals: timeTotalRows
      ? {
          views: asNumber(timeTotalRows.views),
          medianMs: asNumber(timeTotalRows.median_ms),
          p75Ms: asNumber(timeTotalRows.p75_ms),
          engagedViews: asNumber(timeTotalRows.engaged_views),
          quickExits: asNumber(timeTotalRows.quick_exits),
        }
      : null,
    scroll: extractScrollDepth(scrollRows),
    ctas: extractCtaClicks(ctaRows),
    botPaths: botPathRows === null ? null : botPathRows.map((row) => ({ path: asString(row.path), requests: asNumber(row.requests) })),
  };
}

// --- Recordings list ----------------------------------------------------------

/**
 * One summary row per recording, aggregated in SQL: the real table can hold tens of
 * thousands of chunk parts per recording, so the list never reads payloads or parts.
 * `unique_parts` counts distinct chunk parts (delivery is at least once, so rows can be
 * duplicated); `declared_parts` sums the parts each chunk claims. A recording counts as
 * complete when its chunks run from 0 with no missing chunk seq and every declared part
 * stored exactly once.
 */
function recordingsAggregateSql(config: QueryConfig, where: string): string {
  const filter = where ? `WHERE ${where}` : "";
  return `SELECT
  toString(recording_id) AS recording_id,
  toString(session_id) AS session_id,
  min(CAST(first_timestamp AS Int64)) AS start_ms,
  max(CAST(last_timestamp AS Int64)) AS end_ms,
  max(CAST(received_at_ms AS Int64)) AS last_received_ms,
  min(chunk_seq) AS min_seq,
  max(chunk_seq) AS max_seq,
  count() AS chunks,
  sum(chunk_unique_parts) AS unique_parts,
  sum(declared_parts) AS declared_parts,
  sum(CAST(chunk_bytes AS Int64)) AS total_bytes
FROM
(
  SELECT
    recording_id,
    any(session_id) AS session_id,
    CAST(chunk_seq AS UInt32) AS chunk_seq,
    uniqExact(toString(chunk_id)) AS chunk_unique_parts,
    any(CAST(part_count AS UInt32)) AS declared_parts,
    any(CAST(chunk_bytes AS Int64)) AS chunk_bytes,
    min(CAST(first_timestamp AS Int64)) AS first_timestamp,
    max(CAST(last_timestamp AS Int64)) AS last_timestamp,
    max(CAST(received_at_ms AS Int64)) AS received_at_ms
  FROM ${recordingsTable(config)}
  ${filter}
  GROUP BY recording_id, chunk_seq
)
GROUP BY recording_id, session_id`;
}

export function recordingsListSql(config: QueryConfig, limit = 50): string {
  return `${recordingsAggregateSql(config, "")}\nORDER BY start_ms DESC\nLIMIT ${limit}`;
}

export type RecordingListItem = {
  recordingId: string;
  sessionId: string;
  startMs: number;
  endMs: number;
  lastReceivedMs: number;
  chunks: number;
  complete: boolean;
  /** Incomplete but received seconds ago: RawTree reads lag writes briefly. */
  arriving: boolean;
  bytes: number;
};

export function extractRecordings(rows: Record<string, unknown>[], nowMs = Date.now()): RecordingListItem[] {
  return rows.map((row) => {
    const minSeq = asNumber(row.min_seq);
    const maxSeq = asNumber(row.max_seq);
    const chunks = asNumber(row.chunks);
    const uniqueParts = asNumber(row.unique_parts);
    const declaredParts = asNumber(row.declared_parts);
    const lastReceivedMs = asNumber(row.last_received_ms);
    const complete = minSeq === 0 && chunks === maxSeq + 1 && uniqueParts === declaredParts;
    return {
      recordingId: asString(row.recording_id),
      sessionId: asString(row.session_id),
      startMs: asNumber(row.start_ms),
      endMs: asNumber(row.end_ms),
      lastReceivedMs,
      chunks,
      complete,
      // Rows can still be arriving: RawTree reads lag writes and replicas can
      // disagree briefly, so an incomplete recording may fill in moments later.
      arriving: !complete && nowMs - lastReceivedMs < 120_000,
      bytes: asNumber(row.total_bytes),
    };
  });
}

// --- Single recording ---------------------------------------------------------

/** Aggregated summary for one recording, without reading payloads. */
export function recordingSummarySql(config: QueryConfig, recordingId: string): string {
  return recordingsAggregateSql(config, `toString(recording_id) = '${validateRecordingId(recordingId)}'`);
}

export function extractRecordingSummary(
  row: Record<string, unknown> | undefined,
  nowMs = Date.now(),
): RecordingListItem | undefined {
  return row ? extractRecordings([row], nowMs)[0] : undefined;
}

/** Recording chunk metadata (no payloads), ordered by chunk sequence. */
export function recordingMetadataSql(config: QueryConfig, recordingId: string): string {
  const id = validateRecordingId(recordingId);
  const columns = [
    "recording_id",
    "session_id",
    "format_version",
    "chunk_seq",
    "part_index",
    "part_count",
    "event_seq_start",
    "event_seq_end",
    "event_count",
    "first_timestamp",
    "last_timestamp",
    "has_meta",
    "has_full_snapshot",
    "payload_encoding",
    "chunk_bytes",
    "payload_bytes",
  ]
    .map((c) => `toString(${c}) AS ${c}`)
    .join(", ");
  return `SELECT ${columns}
FROM ${recordingsTable(config)}
WHERE toString(recording_id) = '${id}'
ORDER BY chunk_seq, part_index`;
}

// Recording IDs come from URLs; only well-formed IDs reach SQL text.
function validateRecordingId(recordingId: string): string {
  if (!/^[A-Za-z0-9_:.\-]{1,128}$/.test(recordingId)) {
    throw new DashboardQueryError(`Invalid recording id: ${recordingId.slice(0, 32)}`, 400);
  }
  return recordingId;
}

/**
 * Largest payload response for one player fetch. RawTree allows 100 MiB results, but
 * the player only needs the first minutes, and a bounded fetch keeps a runaway
 * recording from stalling a request.
 */
export const MAX_REPLAY_BYTES = 2_000_000;

export type ReplayPayload = {
  recordingId: string;
  complete: boolean;
  gaps: string[];
  truncated: boolean;
  segments: { startTimestamp: number; endTimestamp: number; events: unknown[] }[];
};

/**
 * Fetch one recording for replay: metadata first, then only the payload rows of the
 * chunk range chosen by planFetch (bounded in bytes, starting at a full snapshot).
 * Reassembly reports gaps instead of replaying across them.
 */
export async function getReplay(config: QueryConfig, recordingId: string, fetchImpl?: typeof fetch): Promise<ReplayPayload> {
  const metadataRows = await runQuery(config, recordingMetadataSql(config, recordingId), fetchImpl);
  if (metadataRows.length === 0) {
    throw new DashboardQueryError(`Recording ${recordingId} not found`, 404);
  }
  const metadata = metadataRows.map(parseChunkMetadata);
  const first = metadata[0]!;
  const last = metadata[metadata.length - 1]!;
  const plan = planFetch(metadata, {
    fromTimestamp: first.first_timestamp,
    toTimestamp: last.last_timestamp,
    maxBytes: MAX_REPLAY_BYTES,
  });
  if (!plan) {
    return { recordingId, complete: false, gaps: ["no full snapshot to start replay"], truncated: false, segments: [] };
  }

  const payloadSql = `SELECT recording_id, session_id, format_version, chunk_seq, part_index, part_count,
  event_seq_start, event_seq_end, event_count, first_timestamp, last_timestamp, has_meta, has_full_snapshot,
  payload_encoding, chunk_bytes, payload_bytes, payload
FROM ${recordingsTable(config)}
WHERE toString(recording_id) = '${validateRecordingId(recordingId)}'
  AND CAST(chunk_seq AS UInt32) BETWEEN ${plan.firstChunkSeq} AND ${plan.lastChunkSeq}
ORDER BY chunk_seq, part_index`;
  const payloadRows = await runQuery(config, payloadSql, fetchImpl);
  const rows = payloadRows.map(parseChunkRow);
  const reassembled = reassemble(rows, { firstChunkSeq: plan.firstChunkSeq, lastChunkSeq: plan.lastChunkSeq });
  return {
    recordingId,
    complete: reassembled.complete,
    gaps: reassembled.gaps.map(describeGap),
    truncated: plan.truncated,
    segments: reassembled.segments,
  };
}

export function describeGap(gap: RecordingGap): string {
  switch (gap.kind) {
    case "missing_chunks":
      return gap.fromChunkSeq === gap.toChunkSeq
        ? `Missing chunk ${gap.fromChunkSeq}`
        : `Missing chunks ${gap.fromChunkSeq}-${gap.toChunkSeq}`;
    case "missing_parts":
      return `Chunk ${gap.chunkSeq} is missing part${gap.missingParts.length > 1 ? "s" : ""} ${gap.missingParts.join(", ")}`;
    case "event_sequence":
      return `Event sequence jumps from ${gap.afterEventSeq} to ${gap.nextEventSeq}`;
  }
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, got ${JSON.stringify(value)}`);
  return parsed;
}

function bool(value: unknown): boolean {
  const parsed = typeof value === "string" ? value === "true" || value === "1" : Boolean(value);
  if (typeof parsed !== "boolean") throw new Error(`Expected a boolean, got ${JSON.stringify(value)}`);
  return parsed;
}

function parseChunkMetadata(row: Record<string, unknown>): ChunkMetadata {
  const { payload: _payload, ...rest } = parseChunkRow(row);
  return rest;
}

function parseChunkRow(row: Record<string, unknown>): ChunkRow {
  // RawTree stores every column as Dynamic; numbers and booleans may arrive as strings.
  return {
    recording_id: asString(row.recording_id),
    session_id: asString(row.session_id),
    format_version: num(row.format_version) as 1,
    chunk_seq: num(row.chunk_seq),
    part_index: num(row.part_index),
    part_count: num(row.part_count),
    event_seq_start: num(row.event_seq_start),
    event_seq_end: num(row.event_seq_end),
    event_count: num(row.event_count),
    first_timestamp: num(row.first_timestamp),
    last_timestamp: num(row.last_timestamp),
    has_meta: bool(row.has_meta),
    has_full_snapshot: bool(row.has_full_snapshot),
    payload_encoding: asString(row.payload_encoding) as "json",
    chunk_bytes: num(row.chunk_bytes),
    payload_bytes: num(row.payload_bytes),
    payload: asString(row.payload),
  };
}

// The reassembly helpers are the reader half of the storage format; re-exported here so
// pages and the future agent have one import for dashboard queries.
export { planFetch, reassemble, type ChunkMetadata, type ChunkRow, type RecordingGap, type ReplaySegment } from "./reassembly.ts";
