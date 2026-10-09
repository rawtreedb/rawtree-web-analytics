// Every dashboard query, as SQL text only (lib/dashboard.ts runs them). To tune a widget,
// edit its template below: the doc comment names the widget, and the SQL aliases are the
// field names the page reads. When you add or rename an alias, update that query's row type
// (the run<{...}> call in lib/dashboard.ts) and its use in app/page.tsx.
//
// Rules every query keeps:
// - Delivery is at least once, so the same event_id can be stored twice. Count events with
//   uniqExact(toString(event_id)) (or uniqExact on a session, page view, or chunk ID), never
//   count() over raw rows.
// - RawTree stores every column as Dynamic: wrap columns in toString() or CAST(... AS Int64).
// - Human metrics exclude bots (IS_BOT): every section except Bots counts people only.

import { BOT_UA_PATTERN } from "./crawlers.ts";

/** What every events query needs: the table, the [fromMs, toMs) window, and the table's columns. */
export type Scope = {
  /** Events table name for this deployment, e.g. "events" or "e2e_events". */
  table: string;
  fromMs: number;
  toMs: number;
  /** Columns the table has (from columnsSql). Undefined assumes every column exists. */
  columns?: ReadonlySet<string>;
};

// --- Shared fragments -------------------------------------------------------------

/** Lists the events table's columns (one row per column, in `name`). */
export const columnsSql = (table: string) => `DESCRIBE TABLE ${table}`;

/**
 * RawTree adds a column with the first event that carries it, so a young table can lack
 * these. A missing one reads as NULL, exactly like an existing column on a row without it.
 */
const OPTIONAL_COLUMNS = [
  "session_id",
  "anonymous_id",
  "page_url",
  "page_path",
  "referrer",
  "user_agent",
  "properties.page_view_id",
  "properties.path",
  "properties.elapsed_ms",
  "properties.threshold",
  "properties.cta_id",
  "properties.placement",
];

/** The events table, padded with NULL for optional columns it does not have yet. */
function events(s: Scope): string {
  const missing = OPTIONAL_COLUMNS.filter((name) => s.columns && !s.columns.has(name));
  if (missing.length === 0) return s.table;
  return `(SELECT *, ${missing.map((name) => `CAST(NULL AS Dynamic) AS \`${name}\``).join(", ")} FROM ${s.table})`;
}

const OCCURRED = "CAST(occurred_at_ms AS Int64)";
const inWindow = (s: Scope) => `${OCCURRED} >= ${s.fromMs} AND ${OCCURRED} < ${s.toMs}`;
const PAGE_VIEW = "toString(event_name) = 'page_view'";

/** True for crawler, AI agent, and script user agents (pattern in lib/crawlers.ts). */
const IS_BOT = `match(lower(coalesce(toString(user_agent), '')), '${BOT_UA_PATTERN}')`;

/** Human and bot counts, side by side. Without a user_agent column every event is human. */
const HUMAN_AND_BOT_COUNTS = `uniqExactIf(toString(event_id), NOT isBot) AS events,
  uniqExactIf(toString(event_id), ${PAGE_VIEW} AND NOT isBot) AS pageViews,
  uniqExactIf(toString(session_id), toString(session_id) != '' AND NOT isBot) AS sessions,
  uniqExactIf(toString(anonymous_id), toString(anonymous_id) != '' AND NOT isBot) AS visitors,
  uniqExactIf(toString(event_id), isBot) AS botEvents,
  uniqExactIf(toString(event_id), ${PAGE_VIEW} AND isBot) AS botPageViews`;

// --- Overview and Traffic ---------------------------------------------------------

/**
 * Overview stat cards, Traffic totals, and Bots headline numbers, for one period.
 * Returns humans-only events, pageViews, sessions, visitors; botEvents, botPageViews; and
 * all-traffic allEvents, allPageViews, allSessions, allVisitors (shown when no user agent is stored).
 */
export const overview = (s: Scope) => `WITH ${IS_BOT} AS isBot
SELECT
  uniqExact(toString(event_id)) AS allEvents,
  uniqExactIf(toString(event_id), ${PAGE_VIEW}) AS allPageViews,
  uniqExact(toString(session_id)) AS allSessions,
  uniqExact(toString(anonymous_id)) AS allVisitors,
  ${HUMAN_AND_BOT_COUNTS}
FROM ${events(s)}
WHERE ${inWindow(s)}`;

/** Traffic trend chart, Daily breakdown table, and the stat card sparklines: the overview counts per UTC day (dayMs). */
export const daily = (s: Scope) => `WITH ${IS_BOT} AS isBot
SELECT
  toUnixTimestamp(toStartOfDay(toDateTime(${OCCURRED} / 1000, 'UTC'))) * 1000 AS dayMs,
  ${HUMAN_AND_BOT_COUNTS}
FROM ${events(s)}
WHERE ${inWindow(s)}
GROUP BY dayMs
ORDER BY dayMs ASC`;

// --- Acquisition ------------------------------------------------------------------

// Referrer hosts per channel. A host matches an entry when it starts with it or contains
// it after a dot ("google." matches google.com and www.google.co.uk).
const SEARCH_HOSTS = ["google.", "bing.", "duckduckgo.", "yahoo.", "ecosia.", "search.brave.", "yandex.", "baidu."];
const SOCIAL_HOSTS = ["facebook.", "t.co", "twitter.", "x.com", "linkedin.", "instagram.", "reddit.", "youtube.", "tiktok.", "bsky.", "mastodon."];
const MAIL_HOSTS = ["mail.", "outlook.", "gmail.", "proton."];
/** The host of an http(s) URL, like JavaScript's URL.hostname (ClickHouse's domain() drops "localhost"). */
const URL_HOST = "^[^:/?#]+://(?:[^/?#]*@)?([[][^/?#]*[]]|[^/?#:]*)";
const hostIn = (hosts: string[]) => `multiSearchAny(concat('.', host), [${hosts.map((h) => `'.${h}'`).join(", ")}])`;

/**
 * One row per human session with its first-touch attribution: the referrer and page URL of
 * its earliest event give channel (Direct, Search, Social, Mail, Referral), referrer (host
 * without www., or Direct), and utmSource/utmMedium/utmCampaign (empty when absent).
 */
const firstTouch = (s: Scope) => `SELECT
  sessionId,
  lower(extract(firstReferrer, '${URL_HOST}')) AS host,
  multiIf(firstReferrer = '', 'Direct', host = '', 'Referral', ${hostIn(SEARCH_HOSTS)}, 'Search',
    ${hostIn(SOCIAL_HOSTS)}, 'Social', ${hostIn(MAIL_HOSTS)}, 'Mail', 'Referral') AS channel,
  multiIf(firstReferrer = '', 'Direct', host = '', 'Referral', startsWith(host, 'www.'), substring(host, 5), host) AS referrer,
  decodeURLFormComponent(extractURLParameter(cutFragment(firstPageUrl), 'utm_source')) AS utmSource,
  decodeURLFormComponent(extractURLParameter(cutFragment(firstPageUrl), 'utm_medium')) AS utmMedium,
  decodeURLFormComponent(extractURLParameter(cutFragment(firstPageUrl), 'utm_campaign')) AS utmCampaign
FROM
(
  SELECT
    toString(session_id) AS sessionId,
    argMin(coalesce(toString(referrer), ''), ${OCCURRED}) AS firstReferrer,
    argMin(coalesce(toString(page_url), ''), ${OCCURRED}) AS firstPageUrl
  FROM ${events(s)}
  WHERE ${inWindow(s)} AND toString(session_id) != '' AND NOT ${IS_BOT}
  GROUP BY sessionId
)`;

/** Channels list and Channel mix donut: channel, sessions. */
export const channels = (s: Scope) => `SELECT channel, uniqExact(sessionId) AS sessions
FROM (${firstTouch(s)})
GROUP BY channel
ORDER BY sessions DESC, channel ASC COLLATE 'en'`;

/** Referrers list: referrer, channel, sessions. */
export const referrers = (s: Scope) => `SELECT referrer, channel, uniqExact(sessionId) AS sessions
FROM (${firstTouch(s)})
GROUP BY referrer, channel
ORDER BY sessions DESC, referrer ASC COLLATE 'en'`;

/** Campaigns table: source, medium, campaign (UTM tags, "(none)" when empty), sessions. Only UTM-tagged sessions. */
export const campaigns = (s: Scope) => `SELECT
  if(utmSource = '', '(none)', utmSource) AS source,
  if(utmMedium = '', '(none)', utmMedium) AS medium,
  if(utmCampaign = '', '(none)', utmCampaign) AS campaign,
  uniqExact(sessionId) AS sessions
FROM (${firstTouch(s)})
WHERE utmSource != '' OR utmMedium != '' OR utmCampaign != ''
GROUP BY source, medium, campaign
ORDER BY sessions DESC, source ASC COLLATE 'en'`;

// --- Content ----------------------------------------------------------------------

/** Top pages list and Site sections donut (humans only): path, pageViews, visitors. */
export const topPages = (s: Scope) => `SELECT
  toString(page_path) AS path,
  uniqExact(toString(event_id)) AS pageViews,
  uniqExact(toString(anonymous_id)) AS visitors
FROM ${events(s)}
WHERE ${inWindow(s)} AND ${PAGE_VIEW} AND NOT ${IS_BOT}
GROUP BY path
ORDER BY pageViews DESC, path ASC
LIMIT 50`;

// --- Engagement -------------------------------------------------------------------

/** A page view counts as engaged from this long on the page, and as a quick exit below QUICK_EXIT_MS. */
const ENGAGED_MS = 10_000;
const QUICK_EXIT_MS = 5_000;

/** One row per human page view (deduplicated by page_view_id): pv, its path, and `measure` over its `event` rows. */
const perPageView = (s: Scope, event: string, measure: string) => `SELECT
    toString(properties.page_view_id) AS pv,
    argMax(coalesce(nullIf(toString(properties.path), ''), '(unknown)'), ${OCCURRED}) AS path,
    ${measure}
  FROM ${events(s)}
  WHERE ${inWindow(s)} AND toString(event_name) = '${event}' AND NOT ${IS_BOT}
  GROUP BY pv`;

const pageTimes = (s: Scope) => perPageView(s, "time_on_page", "max(CAST(properties.elapsed_ms AS Int64)) AS ms");
const TIME_STATS = `uniqExact(pv) AS views,
  round(quantile(0.5)(ms)) AS medianMs,
  round(quantile(0.75)(ms)) AS p75Ms,
  countIf(ms >= ${ENGAGED_MS}) AS engagedViews,
  countIf(ms < ${QUICK_EXIT_MS}) AS quickExits`;

const pageScrolls = (s: Scope) => perPageView(s, "scroll_depth", "max(CAST(properties.threshold AS Int64)) AS depth");
const SCROLL_STATS = `uniqExact(pv) AS views,
  round(avg(depth >= 25), 4) AS reached25,
  round(avg(depth >= 50), 4) AS reached50,
  round(avg(depth >= 75), 4) AS reached75,
  round(avg(depth >= 100), 4) AS reached100`;

/** Engagement stat cards (humans only): views, medianMs, p75Ms, engagedViews, quickExits. */
export const timeOnPageTotals = (s: Scope) => `SELECT ${TIME_STATS}
FROM (${pageTimes(s)})`;

/** Page engagement table, time columns: path plus the timeOnPageTotals columns, per path. */
export const timeOnPage = (s: Scope) => `SELECT path, ${TIME_STATS}
FROM (${pageTimes(s)})
GROUP BY path
ORDER BY views DESC, path ASC
LIMIT 50`;

/** Scroll depth list: views, reached25/50/75/100 (share of page views reaching each depth). */
export const scrollDepthTotals = (s: Scope) => `SELECT ${SCROLL_STATS}
FROM (${pageScrolls(s)})`;

/** Page engagement table, scroll columns: path plus the scrollDepthTotals columns, per path. */
export const scrollDepth = (s: Scope) => `SELECT path, ${SCROLL_STATS}
FROM (${pageScrolls(s)})
GROUP BY path
ORDER BY views DESC, path ASC
LIMIT 50`;

/** CTA clicks list (humans only): ctaId, placement, clicks. */
export const ctaClicks = (s: Scope) => `SELECT
  toString(properties.cta_id) AS ctaId,
  toString(properties.placement) AS placement,
  uniqExact(toString(event_id)) AS clicks
FROM ${events(s)}
WHERE ${inWindow(s)} AND toString(event_name) = 'cta_click' AND NOT ${IS_BOT}
GROUP BY ctaId, placement
ORDER BY clicks DESC, ctaId ASC
LIMIT 10`;

// --- Bots -------------------------------------------------------------------------

/** Bot types donut, Top crawlers, AI crawler and Distinct crawlers cards: userAgent, hits (bot page views), classified by lib/crawlers.ts. */
export const botAgents = (s: Scope) => `SELECT
  coalesce(toString(user_agent), '') AS userAgent,
  uniqExact(toString(event_id)) AS hits
FROM ${events(s)}
WHERE ${inWindow(s)} AND ${PAGE_VIEW} AND ${IS_BOT}
GROUP BY userAgent
ORDER BY hits DESC
LIMIT 500`;

/** Most crawled paths list: path, requests (bot page views). */
export const botPaths = (s: Scope) => `SELECT
  coalesce(nullIf(toString(page_path), ''), '(unknown)') AS path,
  uniqExact(toString(event_id)) AS requests
FROM ${events(s)}
WHERE ${inWindow(s)} AND ${PAGE_VIEW} AND ${IS_BOT}
GROUP BY path
ORDER BY requests DESC, path ASC
LIMIT 10`;

/** Every dashboard query over the events table (the dedup test runs each one). */
export const EVENT_QUERIES = {
  overview,
  daily,
  channels,
  referrers,
  campaigns,
  topPages,
  timeOnPageTotals,
  timeOnPage,
  scrollDepthTotals,
  scrollDepth,
  ctaClicks,
  botAgents,
  botPaths,
};

// --- Recordings -------------------------------------------------------------------
// Recording IDs come from URLs: validate them (lib/dashboard.ts) before they reach these.

/** The newest `limit` recording IDs (recordingId) by start time. */
const latestIds = (table: string, limit: number) => `SELECT toString(recording_id) AS recordingId
  FROM ${table}
  GROUP BY toString(recording_id)
  ORDER BY min(CAST(first_timestamp AS Int64)) DESC
  LIMIT ${limit}`;

/** /recordings: the newest recording's ID (recordingId). */
export const latestRecording = (table: string) => latestIds(table, 1);

/**
 * One summary row per recording, aggregated without reading payloads: recordingId,
 * sessionId, startMs, endMs, lastReceivedMs, minSeq, maxSeq, chunks, uniqueParts,
 * declaredParts, bytes. uniqueParts counts distinct chunk_ids (a part can be stored
 * twice); declaredParts sums the parts each chunk claims.
 */
const recordingSummaries = (table: string, where: string) => `SELECT
  toString(recording_id) AS recordingId,
  toString(session_id) AS sessionId,
  min(firstTimestamp) AS startMs,
  max(lastTimestamp) AS endMs,
  max(receivedAt) AS lastReceivedMs,
  min(chunkSeq) AS minSeq,
  max(chunkSeq) AS maxSeq,
  count() AS chunks,
  sum(uniqueParts) AS uniqueParts,
  sum(declaredParts) AS declaredParts,
  sum(chunkBytes) AS bytes
FROM
(
  SELECT
    recording_id,
    any(session_id) AS session_id,
    CAST(chunk_seq AS UInt32) AS chunkSeq,
    uniqExact(toString(chunk_id)) AS uniqueParts,
    any(CAST(part_count AS UInt32)) AS declaredParts,
    any(CAST(chunk_bytes AS Int64)) AS chunkBytes,
    min(CAST(first_timestamp AS Int64)) AS firstTimestamp,
    max(CAST(last_timestamp AS Int64)) AS lastTimestamp,
    max(CAST(received_at_ms AS Int64)) AS receivedAt
  FROM ${table}
  WHERE ${where}
  GROUP BY recording_id, chunkSeq
)
GROUP BY recording_id, session_id`;

/** Recordings sidebar: the summaries of the newest `limit` recordings, newest first. */
export const recordingList = (table: string, limit = 50) =>
  `${recordingSummaries(table, `toString(recording_id) IN (${latestIds(table, limit)})`)}
ORDER BY startMs DESC`;

/** Recording header: the summary of one recording. */
export const recordingSummary = (table: string, id: string) => recordingSummaries(table, `toString(recording_id) = '${id}'`);

/** The stored chunk columns reassembly reads (lib/reassembly.ts ChunkRow, without payload). */
const CHUNK_COLUMNS = `toString(recording_id) AS recording_id,
  toString(session_id) AS session_id,
  CAST(format_version AS Int32) AS format_version,
  CAST(chunk_seq AS Int64) AS chunk_seq,
  CAST(part_index AS Int64) AS part_index,
  CAST(part_count AS Int64) AS part_count,
  CAST(event_seq_start AS Int64) AS event_seq_start,
  CAST(event_seq_end AS Int64) AS event_seq_end,
  CAST(event_count AS Int64) AS event_count,
  CAST(first_timestamp AS Int64) AS first_timestamp,
  CAST(last_timestamp AS Int64) AS last_timestamp,
  CAST(has_meta AS Bool) AS has_meta,
  CAST(has_full_snapshot AS Bool) AS has_full_snapshot,
  toString(payload_encoding) AS payload_encoding,
  CAST(chunk_bytes AS Int64) AS chunk_bytes,
  CAST(payload_bytes AS Int64) AS payload_bytes`;

/** Replay planning: one row per chunk with what planFetch needs, by chunk_seq. */
export const chunkMetadata = (table: string, id: string) => `SELECT
  CAST(chunk_seq AS Int64) AS chunk_seq,
  CAST(has_meta AS Bool) AS has_meta,
  CAST(has_full_snapshot AS Bool) AS has_full_snapshot,
  CAST(first_timestamp AS Int64) AS first_timestamp,
  CAST(last_timestamp AS Int64) AS last_timestamp,
  CAST(chunk_bytes AS Int64) AS chunk_bytes
FROM ${table}
WHERE toString(recording_id) = '${id}'
ORDER BY chunk_seq, CAST(part_index AS Int64)
LIMIT 1 BY chunk_seq`;

/** Replay payload: every stored part (with payload) of chunks firstSeq..lastSeq. */
export const chunkPayloads = (table: string, id: string, firstSeq: number, lastSeq: number) => `SELECT
  ${CHUNK_COLUMNS},
  toString(payload) AS payload
FROM ${table}
WHERE toString(recording_id) = '${id}'
  AND CAST(chunk_seq AS UInt32) BETWEEN ${firstSeq} AND ${lastSeq}
ORDER BY chunk_seq, part_index`;
