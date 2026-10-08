// Deduplicated counting. Delivery is at least once, so a resent event can store the
// same `event_id` twice: every counting query must deduplicate in SQL (uniqExact on the
// event, session, page view, or chunk ID), never count rows. These tests pin that contract plus the row parsing
// shared with the pages. The live numbers were also verified against a hand count.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  botPathsSql,
  botSplitSql,
  ctaClicksSql,
  dailyTrendSql,
  extractRecordings,
  extractSummary,
  extractTopPages,
  isBotUa,
  overviewSummarySql,
  recordingsListSql,
  recordingSummarySql,
  resolveRange,
  scrollDepthSql,
  sessionFirstTouchSql,
  timeOnPageSql,
  timeOnPageTotalsSql,
  topPagesSql,
  uaBreakdownSql,
  type QueryConfig,
} from "../lib/dashboard.ts";
import { isCrawler } from "../lib/crawlers.ts";

const config: QueryConfig = {
  apiUrl: "https://api.rawtree.test",
  database: "web_analytics",
  queryKey: "rt_query",
  tablePrefix: "",
};

describe("counting SQL deduplicates", () => {
  const range = { fromMs: 0, toMs: 1 };
  const rowCount = /[^_a-zA-Z]count\(\)/;

  it("counts events by unique event ID, never by rows", () => {
    for (const sql of [
      overviewSummarySql(config, range),
      topPagesSql(config, range),
      topPagesSql(config, range, 10, false),
      dailyTrendSql(config, range),
      dailyTrendSql(config, range, false),
      uaBreakdownSql(config, range),
      botPathsSql(config, range),
      ctaClicksSql(config, range),
    ]) {
      assert.ok(sql.includes("uniqExact(toString(event_id))"), `must count uniqExact(event_id):\n${sql}`);
      assert.ok(!rowCount.test(sql), `must never count rows instead of IDs:\n${sql}`);
    }
  });

  it("splits humans from bots with deduplicated conditional counts", () => {
    // The bot split feeds every human metric and the bot totals (all minus human), so a
    // plain countIf here would let one resent bot event inflate both sides.
    const sql = botSplitSql(config, range);
    assert.ok(sql.includes("uniqExactIf(toString(event_id), NOT match("), sql);
    assert.ok(sql.includes("uniqExactIf(toString(event_id), toString(event_name) = 'page_view' AND NOT match("), sql);
    assert.ok(sql.includes("uniqExactIf(toString(session_id), toString(session_id) != '' AND NOT match("), sql);
    assert.ok(sql.includes("uniqExactIf(toString(anonymous_id), toString(anonymous_id) != '' AND NOT match("), sql);
    assert.ok(!rowCount.test(sql) && !/countIf\(/.test(sql), sql);
  });

  it("attributes each session once, from its earliest event", () => {
    for (const sql of [sessionFirstTouchSql(config, range), sessionFirstTouchSql(config, range, 10, false)]) {
      assert.ok(/GROUP BY session_id/.test(sql), sql);
      assert.ok(sql.includes("argMin(coalesce(toString(referrer), ''), CAST(occurred_at_ms AS Int64))"), sql);
    }
    assert.ok(sessionFirstTouchSql(config, range).includes("AND NOT match("), "human-only by default");
  });

  it("deduplicates engagement page views by page_view_id before aggregating", () => {
    for (const sql of [timeOnPageSql(config, range), timeOnPageTotalsSql(config, range), scrollDepthSql(config, range)]) {
      assert.ok(sql.includes("toString(properties.page_view_id) AS pv"), `must dedup by page_view_id:\n${sql}`);
      assert.ok(/GROUP BY pv/.test(sql), `must collapse duplicate rows per page view:\n${sql}`);
    }
  });

  it("counts top pages from page_view events only, over the requested range", () => {
    const sql = topPagesSql(config, { fromMs: 1000, toMs: 2000 });
    assert.ok(sql.includes("toString(event_name) = 'page_view'"));
    assert.ok(sql.includes("CAST(occurred_at_ms AS Int64) >= 1000"));
    assert.ok(sql.includes("CAST(occurred_at_ms AS Int64) < 2000"));
  });

  it("deduplicates recording parts by chunk id, not by raw rows", () => {
    for (const sql of [recordingsListSql(config), recordingSummarySql(config, "rec-1")]) {
      assert.ok(sql.includes("uniqExact(toString(chunk_id))"), `must deduplicate parts by chunk_id:\n${sql}`);
      assert.ok(!sql.includes("payload"), `must not read payloads:\n${sql}`);
    }
  });
});

describe("human/bot line", () => {
  // The SQL split (BOT_UA_PATTERN) and the crawler classifier (lib/crawlers.ts) must
  // draw the same line, or the Bots breakdown stops adding up to the bot total.
  const crawlers = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "Claude-User/1.0",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
    "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "Mozilla/5.0 (compatible; GoogleOther)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "WhatsApp/2.23.20.0",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "axios/1.6.0",
    "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
    "Mozilla/5.0 (compatible; Barkrowler/0.9; +https://babbar.tech/crawler)",
    "meta-webindexer/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "Python/3.12 aiohttp/3.9.1",
  ];
  const browsers = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    "",
  ];

  it("classifies known crawlers as bots in both SQL and JavaScript", () => {
    for (const ua of crawlers) {
      assert.equal(isBotUa(ua), true, `SQL pattern misses ${ua}`);
      assert.equal(isCrawler(ua), true, `classifier misses ${ua}`);
    }
  });

  it("keeps regular browsers and missing user agents human", () => {
    for (const ua of browsers) {
      assert.equal(isBotUa(ua), false, `SQL pattern flags ${ua}`);
      assert.equal(isCrawler(ua), false, `classifier flags ${ua}`);
    }
  });
});

describe("row extraction", () => {
  it("parses summary rows from Dynamic columns, numbers or strings", () => {
    assert.deepEqual(extractSummary({ events: "7", sessions: 3, visitors: "2", page_views: "4" }), { events: 7, sessions: 3, visitors: 2, pageViews: 4 });
    assert.deepEqual(extractSummary(undefined), { events: 0, sessions: 0, visitors: 0, pageViews: 0 });
  });

  it("maps top page rows", () => {
    assert.deepEqual(
      extractTopPages([{ path: "/pricing", page_views: "9", visitors: "4" }]),
      [{ path: "/pricing", pageViews: 9, visitors: 4 }],
    );
  });
});

describe("recording completeness", () => {
  const base = {
    start_ms: 1000,
    end_ms: 2000,
    last_received_ms: 500,
    min_seq: 0,
    max_seq: 2,
    chunks: 3,
    unique_parts: 4,
    declared_parts: 4,
    total_bytes: 1234,
  };

  it("marks a recording complete when chunks run from 0 and every declared part is stored once", () => {
    const [recording] = extractRecordings([{ ...base, recording_id: "rec", session_id: "ses" }]);
    assert.equal(recording.complete, true);
    assert.equal(recording.arriving, false);
    assert.equal(recording.chunks, 3);
  });

  it("ignores duplicated part rows when deciding completeness", () => {
    // RawTree can store the same part twice (a resent batch). The SQL counts distinct
    // chunk_ids, so 4 unique parts of 5 declared stay incomplete even though 5 rows
    // (one of them a duplicate) are stored.
    const [missing] = extractRecordings([{ ...base, unique_parts: 4, declared_parts: 5 }]);
    assert.equal(missing.complete, false);
  });

  it("reports a recording with a missing chunk or without chunk 0 as incomplete", () => {
    const [missingMiddle] = extractRecordings([{ ...base, max_seq: 3, chunks: 3 }]);
    assert.equal(missingMiddle.complete, false);
    const [noStart] = extractRecordings([{ ...base, min_seq: 1, max_seq: 2, chunks: 2 }]);
    assert.equal(noStart.complete, false);
  });

  it("labels a very recent incomplete recording as still arriving", () => {
    const now = 1_000_000;
    const [arriving] = extractRecordings(
      [{ ...base, unique_parts: 3, declared_parts: 4, last_received_ms: now - 5_000 }],
      now,
    );
    assert.equal(arriving.complete, false);
    assert.equal(arriving.arriving, true);
    const [stale] = extractRecordings(
      [{ ...base, unique_parts: 3, declared_parts: 4, last_received_ms: now - 10 * 60_000 }],
      now,
    );
    assert.equal(stale.arriving, false);
  });
});

describe("resolveRange", () => {
  const now = Date.UTC(2026, 9, 8, 12, 0, 0); // Thursday

  it("resolves presets in UTC with Monday weeks", () => {
    const window = (range: string) => {
      const { fromMs, toMs } = resolveRange({ range }, now);
      return [new Date(fromMs).toISOString().slice(0, 10), toMs === now ? "now" : new Date(toMs).toISOString().slice(0, 10)];
    };
    assert.deepEqual(window("today"), ["2026-10-08", "now"]);
    assert.deepEqual(window("this_week"), ["2026-10-05", "now"]);
    assert.deepEqual(window("last_week"), ["2026-09-28", "2026-10-05"]);
    assert.deepEqual(window("last_7_days"), ["2026-10-02", "now"]);
    assert.deepEqual(window("last_month"), ["2026-09-01", "2026-10-01"]);
  });

  it("resolves custom ISO timestamps with an exclusive end capped at now", () => {
    const range = resolveRange({ range: "custom", start: "2026-10-01T00:00:00Z", end: "2026-10-09T00:00:00Z" }, now);
    assert.equal(range.fromMs, Date.UTC(2026, 9, 1));
    assert.equal(range.toMs, now);
  });

  it("falls back to the last 7 days on missing or invalid params", () => {
    for (const params of [{}, { range: "bogus" }, { range: "custom", start: "nope", end: "2026-10-08T00:00:00Z" }, { range: "custom", start: "2026-10-08T00:00:00Z", end: "2026-10-01T00:00:00Z" }]) {
      assert.equal(resolveRange(params, now).key, "last_7_days");
    }
  });
});
