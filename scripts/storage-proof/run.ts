// Round-trip synthetic events and rrweb recordings through a storage target and check
// ordering, duplicates, missing data, large snapshots, and payload integrity.
// Usage:
//   node scripts/storage-proof/run.ts --target clickhouse   (local emulation)
//   node scripts/storage-proof/run.ts --target rawtree      (approved disposable database)

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { ARTIFACT_DIR, FIXTURE_DIR } from "./browser.ts";
import {
  buildChunks,
  type ChunkMetadata,
  planFetch,
  reassemble,
  type RecordingChunkRow,
  type RrwebEvent,
} from "./format.ts";
import type { RecordingFixture } from "./record.ts";
import { hostedRawTree, localClickHouse, type StorageTarget } from "./targets.ts";

const targetName = process.argv[process.argv.indexOf("--target") + 1];
const local = targetName === "clickhouse" ? localClickHouse() : undefined;
const target: StorageTarget = local ?? (targetName === "rawtree" ? hostedRawTree() : undefined) ?? fail();
function fail(): never {
  throw new Error("Use --target clickhouse or --target rawtree");
}

const runId = randomUUID().slice(0, 8);
// Hosted runs use temporary proof_* tables so synthetic rows never reach the real
// events/recordings tables. Create them before the run and drop them afterwards.
const TABLE =
  target.name === "rawtree"
    ? { events: "proof_events", recordings: "proof_recordings", recordings_gzip: "proof_recordings_gzip" }
    : { events: "events", recordings: "recordings", recordings_gzip: "recordings_gzip" };
// Below Vercel's 4.5 MB function body limit with room for the envelope and JSON escaping.
const CHUNK_OPTIONS = { maxChunkBytes: 256 * 1024, maxPartBytes: 1024 * 1024 };
const report: Record<string, unknown> = {
  target: target.name,
  runId,
  startedAt: new Date().toISOString(),
  chunkOptions: CHUNK_OPTIONS,
  scenarios: {},
};
const scenarios = report.scenarios as Record<string, unknown>;

function loadFixture(name: string): RecordingFixture {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}.json`, "utf8"));
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 48271) % 2147483647) / 2147483647;
}

function shuffle<T>(items: readonly T[], random = seeded(42)): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] * 10) / 10;
}

/**
 * Poll until a condition holds. Hosted RawTree acknowledges inserts before every
 * replica can read them, so reads right after a write may see a partial state.
 */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 60_000): Promise<number> {
  const start = performance.now();
  while (!(await check())) {
    if (performance.now() - start > timeoutMs) throw new Error(`Not visible after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return Math.round(performance.now() - start);
}

const SAFE_ID = /^[A-Za-z0-9_:.-]+$/;
function sqlString(value: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`Unsafe identifier ${value}`);
  return `'${value}'`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

// ---- Recording SQL (bare field names, explicit casts for Dynamic values) ----

const METADATA_COLUMNS = `
  toString(recording_id) AS recording_id, toString(session_id) AS session_id, toString(chunk_id) AS chunk_id,
  CAST(format_version AS UInt32) AS format_version, CAST(chunk_seq AS UInt32) AS chunk_seq, CAST(part_index AS UInt32) AS part_index,
  CAST(part_count AS UInt32) AS part_count, CAST(event_seq_start AS UInt32) AS event_seq_start, CAST(event_seq_end AS UInt32) AS event_seq_end,
  CAST(event_count AS UInt32) AS event_count, CAST(first_timestamp AS Float64) AS first_timestamp, CAST(last_timestamp AS Float64) AS last_timestamp,
  toString(has_meta) AS has_meta, toString(has_full_snapshot) AS has_full_snapshot, toString(payload_encoding) AS payload_encoding,
  CAST(chunk_bytes AS UInt32) AS chunk_bytes, CAST(payload_bytes AS UInt32) AS payload_bytes`;

type RawRow = Record<string, string | number | boolean>;

function parseRow(row: RawRow): RecordingChunkRow {
  const bool = (value: unknown) => value === true || value === "true" || value === 1 || value === "1";
  return {
    format_version: Number(row.format_version),
    recording_id: String(row.recording_id),
    session_id: String(row.session_id),
    chunk_id: String(row.chunk_id),
    chunk_seq: Number(row.chunk_seq),
    part_index: Number(row.part_index),
    part_count: Number(row.part_count),
    event_seq_start: Number(row.event_seq_start),
    event_seq_end: Number(row.event_seq_end),
    event_count: Number(row.event_count),
    first_timestamp: Number(row.first_timestamp),
    last_timestamp: Number(row.last_timestamp),
    has_meta: bool(row.has_meta),
    has_full_snapshot: bool(row.has_full_snapshot),
    payload_encoding: row.payload_encoding === "gzip+base64" ? "gzip+base64" : "json",
    chunk_bytes: Number(row.chunk_bytes),
    payload_bytes: Number(row.payload_bytes),
    payload: String(row.payload ?? ""),
  };
}

async function fetchMetadata(table: string, recordingId: string) {
  const result = await target.query<RawRow>(
    `SELECT ${METADATA_COLUMNS} FROM ${table} WHERE toString(recording_id) = ${sqlString(recordingId)}
     ORDER BY chunk_seq, part_index LIMIT 1 BY chunk_seq, part_index`,
  );
  return { rows: result.rows.map(parseRow) as ChunkMetadata[], ms: result.ms };
}

async function fetchPayload(table: string, recordingId: string, firstChunkSeq: number, lastChunkSeq: number) {
  const result = await target.query<RawRow>(
    `SELECT ${METADATA_COLUMNS}, toString(payload) AS payload FROM ${table}
     WHERE toString(recording_id) = ${sqlString(recordingId)} AND CAST(chunk_seq AS UInt32) BETWEEN ${firstChunkSeq} AND ${lastChunkSeq}
     ORDER BY chunk_seq, part_index LIMIT 1 BY chunk_seq, part_index`,
  );
  return { rows: result.rows.map(parseRow), ms: result.ms };
}

async function rawCounts(table: string, recordingId: string) {
  const { rows } = await target.query<{ total: number; unique_parts: number }>(
    `SELECT count() AS total, uniqExact(CAST(chunk_seq AS UInt32), CAST(part_index AS UInt32)) AS unique_parts
     FROM ${table} WHERE toString(recording_id) = ${sqlString(recordingId)}`,
  );
  return { total: Number(rows[0].total), uniqueParts: Number(rows[0].unique_parts) };
}

async function upload(table: string, rows: RecordingChunkRow[]) {
  const timings: number[] = [];
  let maxRequestBytes = 0;
  for (const row of rows) {
    const { ms, bytes } = await target.insert(table, [row]);
    timings.push(ms);
    maxRequestBytes = Math.max(maxRequestBytes, bytes);
  }
  return { requests: rows.length, insertP50Ms: percentile(timings, 50), insertP95Ms: percentile(timings, 95), maxRequestBytes };
}

// Small chunk targets emulate an SDK that also flushes on a timer, producing many chunks.
const INTERACTION_CHUNK_BYTES = 16 * 1024;

function chunk(fixture: RecordingFixture, scenario: string, encoding: "json" | "gzip+base64" = "json") {
  const recordingId = `rec_${scenario}_${runId}`;
  const maxChunkBytes = fixture.name === "interaction" ? INTERACTION_CHUNK_BYTES : CHUNK_OPTIONS.maxChunkBytes;
  return buildChunks(fixture.events, { ...CHUNK_OPTIONS, maxChunkBytes, recordingId, sessionId: `ses_${runId}`, encoding });
}

async function roundTrip(
  scenario: string,
  fixture: RecordingFixture,
  rows: RecordingChunkRow[],
  delivered: RecordingChunkRow[],
  table = TABLE.recordings,
  expectedEvents: RrwebEvent[] = fixture.events,
) {
  const recordingId = rows[0].recording_id;
  const uploadStats = await upload(table, delivered);
  const expectedParts = new Set(delivered.map((r) => `${r.chunk_seq}:${r.part_index}`)).size;
  const visibleAfterMs = await waitUntil(async () => {
    const c = await rawCounts(table, recordingId);
    return c.total === delivered.length && c.uniqueParts === expectedParts;
  });
  const metadata = await fetchMetadata(table, recordingId);
  const lastChunkSeq = Math.max(...metadata.rows.map((r) => r.chunk_seq));
  const payload = await fetchPayload(table, recordingId, 0, lastChunkSeq);
  const result = reassemble(payload.rows, { firstChunkSeq: 0, lastChunkSeq });
  const replayed = result.segments.flatMap((s) => s.events);
  const exact = result.complete && JSON.stringify(replayed) === JSON.stringify(expectedEvents);
  const counts = await rawCounts(table, recordingId);
  const summary = {
    recordingId,
    events: expectedEvents.length,
    chunks: lastChunkSeq + 1,
    rows: rows.length,
    deliveredRows: delivered.length,
    storedRows: counts.total,
    uniqueStoredParts: counts.uniqueParts,
    ...uploadStats,
    visibleAfterMs,
    metadataQueryMs: Math.round(metadata.ms),
    payloadQueryMs: Math.round(payload.ms),
    payloadBytes: payload.rows.reduce((a, r) => a + r.payload_bytes, 0),
    complete: result.complete,
    gaps: result.gaps,
    unreplayableChunkSeqs: result.unreplayableChunkSeqs,
    segments: result.segments.map((s) => ({ startChunkSeq: s.startChunkSeq, endChunkSeq: s.endChunkSeq, events: s.events.length })),
    exactEventEquality: exact,
  };
  scenarios[scenario] = summary;
  console.log(`${scenario}: complete=${result.complete} exact=${exact} gaps=${JSON.stringify(result.gaps)}`);
  return { summary, result, replayed };
}

function saveRoundTrip(fixture: RecordingFixture, scenario: string, events: RrwebEvent[]) {
  writeFileSync(`${FIXTURE_DIR}${fixture.name}.${scenario}.${target.name}.roundtrip.json`, JSON.stringify({ events }));
}

// ---- Synthetic asymmetric product events ----

function syntheticEvents(count: number) {
  const random = seeded(7);
  const base = Date.UTC(2026, 9, 7, 10, 0, 0);
  const names = ["page_view", "cta_click", "signup_completed", "project_created", "export_completed", "web_vital"];
  return Array.from({ length: count }, (_, i) => {
    const name = names[i % names.length];
    const occurred = base + Math.floor(i / 3) * 1000; // three events share each timestamp
    const properties: Record<string, unknown> = {
      page_view: { path: `/docs/${i % 7}`, referrer_host: i % 2 ? "news.example" : "" },
      cta_click: { cta_id: "pricing_upgrade", placement: "hero", position: i % 4 },
      signup_completed: { plan: ["free", "pro"][i % 2], method: "email", trial_days: 14 },
      project_created: { template: "blank", tags: ["a", "b", `t${i % 5}`], settings: { private: i % 2 === 0, seats: i } },
      export_completed: { format: "csv", rows: 123456789 + i, duration_ms: Math.round(random() * 5000) / 10, unicode: "Ñandú 😀 ✓" },
      web_vital: { metric_id: `v4-${i}`, name: "LCP", value: 2512.37, rating: "needs-improvement", delta: 0.1 + 0.2 },
    }[name] as Record<string, unknown>;
    // Edge-case values on some rows: nulls, empty containers, date-like and number-like strings.
    if (i % 5 === 0) {
      Object.assign(properties, {
        coupon: null,
        metadata: {},
        empty_list: [],
        started_at_iso: "2026-10-07T10:00:00.123Z",
        day: "2026-10-07",
        account_ref: "007",
        big_id: "9007199254740993",
        mixed: [1, "a", { k: true }],
      });
    }
    return {
      v: 1,
      event_id: `evt_${runId}_${i}`,
      event_name: name,
      occurred_at_ms: occurred,
      received_at_ms: occurred + 150,
      session_id: `ses_${runId}_${i % 9}`,
      anonymous_id: `anon_${i % 13}`,
      ...(i % 4 === 0 ? { user_id: `usr_${i % 5}` } : {}),
      page: { path: `/p/${i % 7}`, title: "Acme · Docs" },
      properties,
    };
  });
}

function diffPaths(expected: unknown, actual: unknown, path = ""): string[] {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  if (expected && actual && typeof expected === "object" && typeof actual === "object" && !Array.isArray(expected)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].flatMap((k) =>
      diffPaths((expected as Record<string, unknown>)[k], (actual as Record<string, unknown>)[k], `${path}.${k}`),
    );
  }
  return [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

async function eventsScenario() {
  const events = syntheticEvents(600);
  const delivered = shuffle([...events, ...events.filter((_, i) => i % 10 === 0)]);
  const timings: number[] = [];
  for (let i = 0; i < delivered.length; i += 100) timings.push((await target.insert(TABLE.events, delivered.slice(i, i + 100))).ms);
  const prefix = `evt_${runId}_`;
  const countSql = `SELECT count() AS total FROM ${TABLE.events} WHERE startsWith(toString(event_id), ${sqlString(prefix)})`;
  const visibleAfterMs = await waitUntil(
    async () => Number((await target.query<{ total: number }>(countSql)).rows[0].total) === delivered.length,
  );
  const counts = await target.query<{ total: number; unique: number }>(
    `SELECT count() AS total, uniqExact(toString(event_id)) AS unique FROM ${TABLE.events} WHERE startsWith(toString(event_id), ${sqlString(prefix)})`,
  );
  const stored = await target.query<{ event_id: string; raw: unknown }>(
    `SELECT toString(event_id) AS event_id, __raw_data AS raw FROM ${TABLE.events}
     WHERE startsWith(toString(event_id), ${sqlString(prefix)}) LIMIT 1 BY event_id`,
  );
  const byId = new Map(stored.rows.map((r) => [r.event_id, typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw]));
  const differences = events.flatMap((e) => diffPaths(e, byId.get(e.event_id)).map((d) => `${e.event_id}${d}`));
  const aggregate = await target.query<{ event_name: string; events: number }>(
    `SELECT toString(event_name) AS event_name, uniqExact(toString(event_id)) AS events FROM ${TABLE.events}
     WHERE startsWith(toString(event_id), ${sqlString(prefix)}) GROUP BY event_name ORDER BY event_name`,
  );
  scenarios.events = {
    events: events.length,
    deliveredRows: delivered.length,
    storedRows: Number(counts.rows[0].total),
    uniqueEventIds: Number(counts.rows[0].unique),
    insertBatchP50Ms: percentile(timings, 50),
    visibleAfterMs,
    rawReadMs: Math.round(stored.ms),
    aggregateMs: Math.round(aggregate.ms),
    dedupedCountsByName: Object.fromEntries(aggregate.rows.map((r) => [r.event_name, Number(r.events)])),
    roundTripDifferences: differences.length,
    differenceExamples: [...new Set(differences.map((d) => d.replace(/^evt_[^.]+/, "")))].slice(0, 12),
  };
  console.log(`events: stored ${counts.rows[0].total} rows, ${counts.rows[0].unique} unique, ${differences.length} differences`);
}

// ---- Run ----

if (local) await local.reset("rwa_proof");

const interaction = loadFixture("interaction");
const large = loadFixture("large-snapshot");

await eventsScenario();

{
  const rows = chunk(interaction, "interaction_clean");
  const { replayed } = await roundTrip("interaction_clean", interaction, rows, rows);
  saveRoundTrip(interaction, "clean", replayed);
}
{
  const rows = chunk(interaction, "interaction_shuffled_dup");
  const delivered = shuffle([...rows, ...rows.filter((_, i) => i % 3 === 0)]);
  const { replayed } = await roundTrip("interaction_shuffled_dup", interaction, rows, delivered);
  saveRoundTrip(interaction, "shuffled_dup", replayed);
}
{
  // Equal timestamps everywhere: only the stored sequence can restore emission order.
  const sameTime = interaction.events.map((e) => ({ ...e, timestamp: interaction.events[0].timestamp }));
  const rows = buildChunks(sameTime, { ...CHUNK_OPTIONS, maxChunkBytes: 8 * 1024, recordingId: `rec_equal_ts_${runId}`, sessionId: `ses_${runId}` });
  await roundTrip("interaction_equal_timestamps", interaction, rows, shuffle(rows), TABLE.recordings, sameTime);
}
{
  const rows = chunk(interaction, "interaction_missing_chunk");
  const snapshotSeqs = new Set(rows.filter((r) => r.has_meta).map((r) => r.chunk_seq));
  const removed = rows.find((r) => r.chunk_seq > 0 && !snapshotSeqs.has(r.chunk_seq))?.chunk_seq;
  const { summary } = await roundTrip(
    "interaction_missing_chunk",
    interaction,
    rows,
    rows.filter((r) => r.chunk_seq !== removed),
  );
  Object.assign(summary, { removedChunkSeq: removed, snapshotChunkSeqs: [...snapshotSeqs] });
}
{
  const rows = chunk(large, "large_clean");
  const { replayed, summary } = await roundTrip("large_snapshot_clean", large, rows, rows);
  Object.assign(summary, {
    largestEventBytes: Math.max(...large.events.map((e) => Buffer.byteLength(JSON.stringify(e)))),
    snapshotParts: rows.filter((r) => r.chunk_seq === 0).length,
  });
  saveRoundTrip(large, "clean", replayed);
}
{
  const rows = chunk(large, "large_missing_part");
  await roundTrip(
    "large_snapshot_missing_part",
    large,
    rows,
    rows.filter((r) => !(r.chunk_seq === 0 && r.part_index === 2)),
  );
}
{
  const rows = chunk(large, "large_gzip", "gzip+base64");
  const { replayed } = await roundTrip("large_snapshot_gzip_base64", large, rows, rows, TABLE.recordings_gzip);
  saveRoundTrip(large, "gzip", replayed);
  const interactionGzip = chunk(interaction, "interaction_gzip", "gzip+base64");
  await roundTrip("interaction_gzip_base64", interaction, interactionGzip, interactionGzip, TABLE.recordings_gzip);
}
{
  // Storage-level deduplication with a stable token (best effort; readers still deduplicate).
  const [row] = chunk(interaction, "dedup_token");
  await target.insert(TABLE.recordings, [row], { dedupToken: row.chunk_id });
  await target.insert(TABLE.recordings, [row], { dedupToken: row.chunk_id });
  await waitUntil(async () => (await rawCounts(TABLE.recordings, row.recording_id)).total >= 1);
  await new Promise((resolve) => setTimeout(resolve, 5000)); // let a non-deduplicated copy surface
  const counts = await rawCounts(TABLE.recordings, row.recording_id);
  scenarios.storage_dedup_token = { sent: 2, stored: counts.total };
  console.log(`storage dedup token: sent 2, stored ${counts.total}`);
}
{
  // Read-after-write lag: how long until a single acknowledged row is queryable.
  const lags: number[] = [];
  for (let i = 0; i < 10; i++) {
    const id = `raw_${runId}_${i}`;
    await target.insert(TABLE.events, [{ v: 1, event_id: id, event_name: "read_after_write_probe", occurred_at_ms: Date.now() }]);
    lags.push(
      await waitUntil(async () => {
        const { rows } = await target.query<{ n: number }>(
          `SELECT count() AS n FROM ${TABLE.events} WHERE toString(event_id) = ${sqlString(id)}`,
        );
        return Number(rows[0].n) === 1;
      }),
    );
  }
  scenarios.read_after_write = { samples: lags, p50Ms: percentile(lags, 50), maxMs: Math.max(...lags) };
  console.log(`read-after-write lag: ${JSON.stringify(scenarios.read_after_write)}`);
}
{
  // Bounded retrieval: replay only the window after the mid-recording checkout.
  const recordingId = `rec_interaction_clean_${runId}`;
  const metadata = await fetchMetadata(TABLE.recordings, recordingId);
  const checkout = metadata.rows.filter((r) => r.has_meta)[1];
  const lastTimestamp = Math.max(...metadata.rows.map((r) => r.last_timestamp));
  const plan = planFetch(metadata.rows, { fromTimestamp: checkout.first_timestamp + 1, toTimestamp: lastTimestamp, maxBytes: 512 * 1024 });
  assert.ok(plan);
  const payload = await fetchPayload(TABLE.recordings, recordingId, plan.firstChunkSeq, plan.lastChunkSeq);
  const result = reassemble(payload.rows, { firstChunkSeq: plan.firstChunkSeq, lastChunkSeq: plan.lastChunkSeq });
  const startSeq = metadata.rows.find((r) => r.chunk_seq === plan.firstChunkSeq)?.event_seq_start ?? -1;
  const expected = interaction.events.slice(startSeq, startSeq + result.segments[0].events.length);
  scenarios.bounded_fetch = {
    plan,
    totalBytes: metadata.rows.reduce((a, r) => a + r.payload_bytes, 0),
    fetchedBytes: payload.rows.reduce((a, r) => a + r.payload_bytes, 0),
    startsAtCheckoutChunk: plan.firstChunkSeq === checkout.chunk_seq,
    complete: result.complete,
    matchesOriginalSlice: JSON.stringify(result.segments[0].events) === JSON.stringify(expected),
    queryMs: Math.round(payload.ms),
  };
  console.log(`bounded fetch: ${JSON.stringify(scenarios.bounded_fetch)}`);
}

{
  // Which privacy sentinels survive into stored JSON payloads (raw or URL-encoded)?
  const found: Record<string, number> = {};
  for (const [name, value] of Object.entries(interaction.sentinels)) {
    const forms = [...new Set([value, encodeURIComponent(value)])];
    const condition = forms.map((form) => `position(toString(payload), ${sqlLiteral(form)}) > 0`).join(" OR ");
    const { rows } = await target.query<{ n: number }>(
      `SELECT countIf(${condition}) AS n FROM ${TABLE.recordings} WHERE startsWith(toString(recording_id), 'rec_interaction_clean_${runId}')`,
    );
    found[name] = Number(rows[0].n);
  }
  scenarios.stored_sentinels = found;
  console.log(`stored sentinel rows: ${JSON.stringify(found)}`);
}

// ---- Sizes ----
const sizes = Object.fromEntries(
  [interaction, large].map((fixture) => {
    const json = JSON.stringify(fixture.events);
    const durationS = (fixture.events[fixture.events.length - 1].timestamp - fixture.events[0].timestamp) / 1000;
    return [
      fixture.name,
      {
        events: fixture.events.length,
        durationS,
        jsonBytes: Buffer.byteLength(json),
        gzipBytes: gzipSync(json).byteLength,
        fullSnapshotBytes: fixture.events.filter((e) => e.type === 2).map((e) => Buffer.byteLength(JSON.stringify(e))),
      },
    ];
  }),
);
report.recordingSizes = sizes;
if (local) {
  report.localStorage = {
    recordings_json: await local.storage("recordings"),
    recordings_gzip: await local.storage("recordings_gzip"),
    events: await local.storage("events"),
  };
}

report.finishedAt = new Date().toISOString();
const reportPath = `${ARTIFACT_DIR}storage-proof-${target.name}.json`;
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Report: ${reportPath}`);

const expectations: [string, boolean][] = [
  ["clean interaction exact", (scenarios.interaction_clean as { exactEventEquality: boolean }).exactEventEquality],
  ["shuffled+duplicated exact", (scenarios.interaction_shuffled_dup as { exactEventEquality: boolean }).exactEventEquality],
  ["equal timestamps exact", (scenarios.interaction_equal_timestamps as { exactEventEquality: boolean }).exactEventEquality],
  ["missing chunk reported", (scenarios.interaction_missing_chunk as { complete: boolean }).complete === false],
  ["large snapshot exact", (scenarios.large_snapshot_clean as { exactEventEquality: boolean }).exactEventEquality],
  ["missing part reported", (scenarios.large_snapshot_missing_part as { complete: boolean }).complete === false],
  ["gzip variant exact", (scenarios.large_snapshot_gzip_base64 as { exactEventEquality: boolean }).exactEventEquality],
  ["bounded fetch correct", (scenarios.bounded_fetch as { matchesOriginalSlice: boolean }).matchesOriginalSlice],
  ["event ids deduplicated", (scenarios.events as { uniqueEventIds: number }).uniqueEventIds === 600],
];
for (const [name, ok] of expectations) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (expectations.some(([, ok]) => !ok)) process.exitCode = 1;
