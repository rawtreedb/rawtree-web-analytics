import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CollectorConfig, handleCollect, handleCollectOptions, loadCollectorConfig } from "../lib/collect.ts";

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const ORIGIN = "https://shop.example";
const config: CollectorConfig = {
  rawtree: { apiUrl: "https://rawtree.test", database: "web_analytics", key: "rt_ingest", tablePrefix: "" },
  allowedOrigins: [ORIGIN],
  serverToken: "server-secret",
};

type Insert = { url: URL; rows: Record<string, unknown>[]; auth: string | null };

function rawtree(status = 200) {
  const inserts: Insert[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const rows = JSON.parse(String(init.body)) as Record<string, unknown>[];
    inserts.push({ url: new URL(url), rows, auth: new Headers(init.headers).get("authorization") });
    const body = status === 200 ? { inserted: rows.length } : { error: "unavailable" };
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { inserts, fetch };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    sent_at: NOW - 100,
    events: [{ event_id: "evt_1", name: "page_view", occurred_at: NOW - 500, session_id: "ses_1", page_url: "https://shop.example/a" }],
    recording_parts: [
      {
        recording_id: "rec_1", session_id: "ses_1", chunk_seq: 0, part_index: 0, part_count: 1,
        event_seq_start: 0, event_seq_end: 0, event_count: 1, first_timestamp: NOW - 900, last_timestamp: NOW - 900,
        has_meta: true, has_full_snapshot: false, chunk_bytes: 26, payload: '[{"type":4,"timestamp":1}]',
      },
    ],
    ...overrides,
  };
}

function post(payload: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return new Request("https://collector.example/api/collect", {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const collect = (request: Request, fetch: typeof globalThis.fetch, cfg = config) => handleCollect(request, cfg, fetch, () => NOW);

describe("handleCollect", () => {
  it("stores events and recording parts from an allowed origin and acknowledges after RawTree accepts", async () => {
    const { inserts, fetch } = rawtree();
    const response = await collect(post(body()), fetch);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: { events: 1, recording_parts: 1 } });
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
    const byTable = Object.fromEntries(inserts.map((i) => [i.url.pathname, i]));
    const events = byTable["/v1/tables/events"];
    assert.equal(events.auth, "Bearer rt_ingest");
    assert.equal(events.url.searchParams.get("database"), "web_analytics");
    assert.equal(events.url.searchParams.get("deduplicate_insert"), "enable");
    assert.deepEqual(
      [events.rows[0].source, events.rows[0].received_at_ms, events.rows[0].client_sent_at_ms, events.rows[0].page_path],
      ["browser", NOW, NOW - 100, "/a"],
    );
    assert.equal(byTable["/v1/tables/recordings"].rows[0].chunk_id, "rec_1:0:0");
  });

  it("stores the request User-Agent when the event carries none", async () => {
    const { inserts, fetch } = rawtree();
    const response = await collect(post(body(), { origin: ORIGIN, "user-agent": "Mozilla/5.0 Test" }), fetch);
    assert.equal(response.status, 200);
    const events = inserts.find((i) => i.url.pathname === "/v1/tables/events");
    assert.equal(events?.rows[0].user_agent, "Mozilla/5.0 Test");
  });

  it("uses the same deduplication token when a batch is retried", async () => {
    const first = rawtree();
    const second = rawtree();
    await collect(post(body()), first.fetch);
    await collect(post(body()), second.fetch);
    const tokens = (r: { inserts: Insert[] }) => r.inserts.map((i) => i.url.searchParams.get("insert_deduplication_token")).sort();
    assert.deepEqual(tokens(first), tokens(second));
  });

  it("writes to prefixed tables when configured", async () => {
    const { inserts, fetch } = rawtree();
    await collect(post(body()), fetch, { ...config, rawtree: { ...config.rawtree, tablePrefix: "e2e_" } });
    assert.deepEqual(inserts.map((i) => i.url.pathname).sort(), ["/v1/tables/e2e_events", "/v1/tables/e2e_recordings"]);
  });

  it("marks server-token requests as server events without an origin", async () => {
    const { inserts, fetch } = rawtree();
    const response = await collect(post(body({ recording_parts: [] }), { authorization: "Bearer server-secret" }), fetch);
    assert.equal(response.status, 200);
    assert.equal(inserts[0].rows[0].source, "server");
  });

  const rejected: [string, () => Request, number, string][] = [
    ["disallowed origin", () => post(body(), { origin: "https://evil.example" }), 403, "origin_not_allowed"],
    ["missing origin and token", () => post(body(), {}), 403, "origin_not_allowed"],
    ["wrong server token", () => post(body(), { authorization: "Bearer nope" }), 401, "invalid_token"],
    ["invalid JSON", () => post("{nope"), 400, "invalid_json"],
    ["invalid request", () => post(body({ v: 9 })), 400, "invalid_request"],
    ["streamed body over the limit", () => post("x".repeat(1_000_001)), 413, "payload_too_large"],
    ["declared body over the limit", () => post("{}", { origin: ORIGIN, "content-length": "2000000" }), 413, "payload_too_large"],
  ];
  for (const [name, request, status, error] of rejected) {
    it(`rejects ${name} without writing`, async () => {
      const { inserts, fetch } = rawtree();
      const response = await collect(request(), fetch);
      assert.equal(response.status, status);
      assert.equal(((await response.json()) as { error: string }).error, error);
      assert.equal(inserts.length, 0);
    });
  }

  it("returns a retryable 503 when RawTree fails", async () => {
    const { fetch } = rawtree(503);
    const response = await collect(post(body()), fetch);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN, "the browser can read the status");
  });

  it("returns 500 when configuration is missing", async () => {
    const original = process.env.RAWTREE_INGEST_KEY;
    delete process.env.RAWTREE_INGEST_KEY;
    const response = await handleCollect(post(body()), undefined, rawtree().fetch);
    assert.equal(response.status, 500);
    if (original !== undefined) process.env.RAWTREE_INGEST_KEY = original;
  });
});

describe("handleCollectOptions", () => {
  it("answers preflight only for allowed origins", () => {
    const allowed = handleCollectOptions(new Request("https://c.example", { method: "OPTIONS", headers: { origin: ORIGIN } }), config);
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
    const denied = handleCollectOptions(new Request("https://c.example", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), config);
    assert.equal(denied.status, 403);
  });
});

it("parses allowed origins and the wildcard", () => {
  const env = { RAWTREE_DATABASE: "d", RAWTREE_INGEST_KEY: "k", ANALYTICS_ALLOWED_ORIGINS: "https://a.example/, https://b.example" };
  assert.deepEqual(loadCollectorConfig(env).allowedOrigins, ["https://a.example", "https://b.example"]);
  assert.equal(loadCollectorConfig({ ...env, ANALYTICS_ALLOWED_ORIGINS: "*" }).allowedOrigins, "*");
  assert.throws(() => loadCollectorConfig({}), /RAWTREE_DATABASE/);
});
