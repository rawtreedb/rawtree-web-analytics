// Deduplicated counting. Delivery is at least once, so a resent event can store the
// same `event_id` twice: every counting query must deduplicate in SQL (uniqExact on the
// event, session, page view, or chunk ID), never count rows. These tests pin that contract
// for every dashboard query in lib/queries.ts, plus the row coercion shared with the pages.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRecording } from "../lib/dashboard.ts";
import { campaigns, EVENT_QUERIES, recordingList, recordingSummary, topPages, type Scope } from "../lib/queries.ts";
import { resolveRange } from "../lib/range.ts";
import { runQuery } from "../lib/rawtree.ts";
import { isBotUa, isCrawler } from "../lib/crawlers.ts";

describe("counting SQL deduplicates", () => {
  const all: Scope = { table: "events", fromMs: 0, toMs: 1 };
  // A young table without user agents or referrers: the queries must still deduplicate.
  const young: Scope = { ...all, columns: new Set(["event_id", "event_name", "occurred_at_ms", "session_id", "anonymous_id", "page_url", "page_path"]) };
  const rowCount = /[^_a-zA-Z]count\(\)/;

  it("counts with uniqExact on IDs in every dashboard query, never by rows", () => {
    for (const scope of [all, young]) {
      for (const [name, query] of Object.entries(EVENT_QUERIES)) {
        const sql = query(scope);
        assert.ok(sql.includes("uniqExact"), `${name} must count unique IDs:\n${sql}`);
        assert.ok(!rowCount.test(sql), `${name} must never count rows instead of IDs:\n${sql}`);
        assert.ok(!/[^_a-zA-Z]countIf\(toString\(event_id\)/.test(sql), `${name} must not countIf events:\n${sql}`);
      }
    }
  });

  it("splits humans from bots with deduplicated conditional counts", () => {
    for (const sql of [EVENT_QUERIES.overview(all), EVENT_QUERIES.daily(all)]) {
      assert.ok(sql.includes("uniqExactIf(toString(event_id), NOT isBot) AS events"), sql);
      assert.ok(sql.includes("uniqExactIf(toString(event_id), isBot) AS botEvents"), sql);
      assert.ok(sql.includes("toString(session_id) != '' AND NOT isBot) AS sessions"), sql);
    }
  });

  it("reads missing optional columns as NULL", () => {
    const sql = EVENT_QUERIES.overview(young);
    assert.ok(sql.includes("CAST(NULL AS Dynamic) AS `user_agent`"), sql);
    assert.ok(!sql.includes("AS `session_id`"), "existing columns are read as stored");
    assert.ok(!EVENT_QUERIES.overview(all).includes("CAST(NULL"), "no padding when every column exists");
  });

  it("attributes each session once, from its earliest event", () => {
    const sql = campaigns(all);
    assert.ok(/GROUP BY sessionId/.test(sql), sql);
    assert.ok(sql.includes("argMin(coalesce(toString(referrer), ''), CAST(occurred_at_ms AS Int64))"), sql);
    assert.ok(sql.includes("uniqExact(sessionId) AS sessions"), sql);
  });

  it("deduplicates engagement page views by page_view_id before aggregating", () => {
    const { timeOnPage, timeOnPageTotals, scrollDepth, scrollDepthTotals } = EVENT_QUERIES;
    for (const sql of [timeOnPage(all), timeOnPageTotals(all), scrollDepth(all), scrollDepthTotals(all)]) {
      assert.ok(sql.includes("toString(properties.page_view_id) AS pv"), `must dedup by page_view_id:\n${sql}`);
      assert.ok(/GROUP BY pv/.test(sql), `must collapse duplicate rows per page view:\n${sql}`);
    }
  });

  it("counts top pages from human page_view events only, over the requested range", () => {
    const sql = topPages({ table: "events", fromMs: 1000, toMs: 2000 });
    assert.ok(sql.includes("toString(event_name) = 'page_view'"));
    assert.ok(sql.includes("NOT match(lower(coalesce(toString(user_agent), ''))"));
    assert.ok(sql.includes("CAST(occurred_at_ms AS Int64) >= 1000"));
    assert.ok(sql.includes("CAST(occurred_at_ms AS Int64) < 2000"));
  });

  it("deduplicates recording parts by chunk id, not by raw rows", () => {
    for (const sql of [recordingList("recordings"), recordingSummary("recordings", "rec-1")]) {
      assert.ok(sql.includes("uniqExact(toString(chunk_id))"), `must deduplicate parts by chunk_id:\n${sql}`);
      assert.ok(!sql.includes("payload"), `must not read payloads:\n${sql}`);
    }
    assert.ok(recordingList("recordings").includes("IN (SELECT toString(recording_id) AS recordingId"), "aggregates only the newest recordings");
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

describe("row coercion", () => {
  const respond = (meta: { name: string; type: string }[], data: Record<string, unknown>[]) =>
    (async () => new Response(JSON.stringify({ meta, data }))) as unknown as typeof fetch;
  const config = { apiUrl: "https://api.rawtree.test", database: "web_analytics", key: "rt_query", tablePrefix: "" };

  it("types values by column type, so numeric-looking IDs stay strings", async () => {
    const fetchImpl = respond(
      [{ name: "events", type: "UInt64" }, { name: "ctaId", type: "String" }, { name: "medianMs", type: "Float64" }, { name: "has_meta", type: "Bool" }],
      [{ events: "7", ctaId: "123", medianMs: null, has_meta: true }],
    );
    assert.deepEqual(await runQuery(config, "SELECT 1", fetchImpl), [{ events: 7, ctaId: "123", medianMs: 0, has_meta: true }]);
  });
});

describe("recording completeness", () => {
  const base = {
    recordingId: "rec",
    sessionId: "ses",
    startMs: 1000,
    endMs: 2000,
    lastReceivedMs: 500,
    minSeq: 0,
    maxSeq: 2,
    chunks: 3,
    uniqueParts: 4,
    declaredParts: 4,
    bytes: 1234,
  };

  it("marks a recording complete when chunks run from 0 and every declared part is stored once", () => {
    const recording = toRecording(base);
    assert.equal(recording.complete, true);
    assert.equal(recording.arriving, false);
    assert.equal(recording.chunks, 3);
  });

  it("ignores duplicated part rows when deciding completeness", () => {
    // RawTree can store the same part twice (a resent batch). The SQL counts distinct
    // chunk_ids, so 4 unique parts of 5 declared stay incomplete even though 5 rows
    // (one of them a duplicate) are stored.
    assert.equal(toRecording({ ...base, uniqueParts: 4, declaredParts: 5 }).complete, false);
  });

  it("reports a recording with a missing chunk or without chunk 0 as incomplete", () => {
    assert.equal(toRecording({ ...base, maxSeq: 3, chunks: 3 }).complete, false);
    assert.equal(toRecording({ ...base, minSeq: 1, maxSeq: 2, chunks: 2 }).complete, false);
  });

  it("labels a very recent incomplete recording as still arriving", () => {
    const now = 1_000_000;
    const arriving = toRecording({ ...base, uniqueParts: 3, declaredParts: 4, lastReceivedMs: now - 5_000 }, now);
    assert.equal(arriving.complete, false);
    assert.equal(arriving.arriving, true);
    const stale = toRecording({ ...base, uniqueParts: 3, declaredParts: 4, lastReceivedMs: now - 10 * 60_000 }, now);
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
