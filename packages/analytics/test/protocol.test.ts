import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LIMITS, parseCollectRequest, toRows } from "../src/protocol.ts";
import { SDK_VERSION } from "../src/util.ts";

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

function event(overrides: Record<string, unknown> = {}) {
  return { event_id: "evt_1", name: "checkout_started", occurred_at: NOW - 1000, ...overrides };
}

function part(overrides: Record<string, unknown> = {}) {
  return {
    recording_id: "rec_1",
    session_id: "ses_1",
    chunk_seq: 0,
    part_index: 0,
    part_count: 1,
    event_seq_start: 0,
    event_seq_end: 1,
    event_count: 2,
    first_timestamp: NOW - 2000,
    last_timestamp: NOW - 1000,
    has_meta: true,
    has_full_snapshot: true,
    chunk_bytes: 2,
    payload: "[]",
    ...overrides,
  };
}

const request = (body: Record<string, unknown>) => parseCollectRequest({ v: 1, sent_at: NOW, ...body }, NOW);

describe("parseCollectRequest", () => {
  it("accepts a valid mixed request and removes nulls and empty objects from properties", () => {
    const result = request({
      events: [event({ properties: { plan: "pro", coupon: null, meta: {}, nested: { a: null, b: 1 }, list: [1, null] } })],
      recording_parts: [part()],
    });
    assert.ok(result.ok);
    assert.deepEqual(result.request.events?.[0].properties, { plan: "pro", nested: { b: 1 }, list: [1] });
    assert.equal(result.eventCount, 1);
    assert.equal(result.partCount, 1);
  });

  const invalid: [string, Record<string, unknown>, RegExp][] = [
    ["wrong version", { v: 2, events: [event()] }, /protocol version/],
    ["empty request", { events: [] }, /no events/],
    ["bad event id", { events: [event({ event_id: "has space" })] }, /event_id/],
    ["bad event name", { events: [event({ name: "<script>" })] }, /name/],
    ["future timestamp", { events: [event({ occurred_at: NOW + 2 * 86_400_000 })] }, /occurred_at/],
    ["fractional timestamp", { events: [event({ occurred_at: NOW - 0.5 })] }, /occurred_at/],
    ["non-http page url", { events: [event({ page_url: "javascript:alert(1)" })] }, /page_url/],
    ["properties not an object", { events: [event({ properties: [1] })] }, /properties/],
    ["properties too large", { events: [event({ properties: { x: "y".repeat(LIMITS.maxPropertiesBytes) } })] }, /exceed/],
    ["too many events", { events: Array.from({ length: LIMITS.maxEventsPerRequest + 1 }, (_, i) => event({ event_id: `e${i}` })) }, /at most/],
    ["part index out of range", { recording_parts: [part({ part_index: 1 })] }, /part_index/],
    ["sequence mismatch", { recording_parts: [part({ event_count: 3 })] }, /sequence range/],
    ["payload too large", { recording_parts: [part({ payload: "x".repeat(LIMITS.maxPartPayloadBytes + 1) })] }, /payload exceeds/],
  ];
  for (const [name, body, message] of invalid) {
    it(`rejects ${name}`, () => {
      const result = parseCollectRequest({ v: 1, sent_at: NOW, ...body }, NOW);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, message);
    });
  }
});

describe("toRows", () => {
  it("adds receipt time, source, page path, and recording identifiers", () => {
    const result = request({
      sdk: "@rawtree/analytics@0.1.0",
      events: [event({ page_url: "https://shop.example/pricing?utm_source=x", user_id: "usr_1" })],
      recording_parts: [part({ chunk_seq: 3, part_index: 0, payload: '[{"é":1}]' })],
    });
    assert.ok(result.ok);
    const rows = toRows(result.request, { receivedAt: NOW, source: "browser" });
    assert.deepEqual(rows.events[0], {
      v: 1,
      event_id: "evt_1",
      event_name: "checkout_started",
      occurred_at_ms: NOW - 1000,
      client_sent_at_ms: NOW,
      received_at_ms: NOW,
      source: "browser",
      sdk: "@rawtree/analytics@0.1.0",
      user_id: "usr_1",
      page_url: "https://shop.example/pricing?utm_source=x",
      page_path: "/pricing",
      properties: {},
    });
    assert.equal(rows.recordings[0].chunk_id, "rec_1:3:0");
    assert.equal(rows.recordings[0].payload_bytes, 10);
    assert.equal(rows.recordings[0].source, "browser");
  });
});

it("SDK_VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(SDK_VERSION, pkg.version);
});
