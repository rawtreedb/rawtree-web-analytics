// Verify an end-to-end run in RawTree: compare stored events with the rows the sample
// smoke test saw accepted, check deduplicated counts, and reassemble stored recordings.
//
//   set -a; . ./.env.local; set +a
//   RAWTREE_TABLE_PREFIX=e2e_ node test/e2e/verify-rawtree.ts .amp/in/e2e-accepted-events.jsonl
//
// Uses only the read-only query key. Writes nothing.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reassemble, type RecordingChunkRow } from "../../scripts/storage-proof/format.ts";

const { RAWTREE_API_URL = "https://api.rawtree.com", RAWTREE_DATABASE, RAWTREE_QUERY_KEY, RAWTREE_TABLE_PREFIX = "" } = process.env;
if (!RAWTREE_DATABASE || !RAWTREE_QUERY_KEY) throw new Error("Load .env.local first");
const events = `${RAWTREE_TABLE_PREFIX}events`;
const recordings = `${RAWTREE_TABLE_PREFIX}recordings`;

async function query<T>(sql: string): Promise<T[]> {
  const response = await fetch(`${RAWTREE_API_URL}/v1/query?database=${RAWTREE_DATABASE}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RAWTREE_QUERY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Query failed (${response.status}): ${text.slice(0, 400)}\n${sql}`);
  return (JSON.parse(text) as { data: T[] }).data;
}

const expected = readFileSync(process.argv[2], "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
const ids = [...new Set(expected.map((e) => String(e.event_id)))];
const idList = ids.map((id) => `'${id.replace(/'/g, "")}'`).join(",");

// Rows are visible after a short replication lag; poll until every ID is readable.
let stored: { event_id: string; raw: Record<string, unknown> }[] = [];
for (let attempt = 0; attempt < 30; attempt++) {
  stored = await query(`SELECT toString(event_id) AS event_id, __raw_data AS raw FROM ${events} WHERE toString(event_id) IN (${idList})`);
  if (new Set(stored.map((r) => r.event_id)).size === ids.length) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const storedIds = new Set(stored.map((r) => r.event_id));
assert.equal(storedIds.size, ids.length, `all ${ids.length} accepted events are stored`);

// Field-by-field comparison, ignoring transport metadata: the receipt time each collector
// assigned itself, and the client send time (a retried request stores its first attempt).
const byId = new Map(stored.map((r) => [r.event_id, r.raw]));
const mismatches: string[] = [];
for (const row of expected) {
  const actual = { ...(byId.get(String(row.event_id)) ?? {}) };
  const wanted = { ...row };
  for (const field of ["received_at_ms", "client_sent_at_ms"]) {
    delete actual[field];
    delete wanted[field];
  }
  if (JSON.stringify(sortKeys(actual)) !== JSON.stringify(sortKeys(wanted))) mismatches.push(`${row.event_id}: ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`);
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
  return value;
}

const counts = await query<{ event_name: string; rows: number; events: number }>(
  `SELECT toString(event_name) AS event_name, count() AS rows, uniqExact(toString(event_id)) AS events
   FROM ${events} WHERE toString(event_id) IN (${idList}) GROUP BY event_name ORDER BY event_name`,
);
const expectedCounts: Record<string, number> = {};
for (const id of ids) {
  const name = String(expected.find((e) => e.event_id === id)?.event_name);
  expectedCounts[name] = (expectedCounts[name] ?? 0) + 1;
}

const sessionList = [...new Set(expected.map((e) => `'${String(e.session_id ?? "").replace(/'/g, "")}'`))].join(",");
const parts = await query<Record<string, string | number | boolean>>(
  `SELECT toString(recording_id) AS recording_id, toString(session_id) AS session_id, toString(chunk_id) AS chunk_id,
     CAST(format_version AS UInt32) AS format_version, CAST(chunk_seq AS UInt32) AS chunk_seq, CAST(part_index AS UInt32) AS part_index,
     CAST(part_count AS UInt32) AS part_count, CAST(event_seq_start AS UInt32) AS event_seq_start, CAST(event_seq_end AS UInt32) AS event_seq_end,
     CAST(event_count AS UInt32) AS event_count, CAST(first_timestamp AS Float64) AS first_timestamp, CAST(last_timestamp AS Float64) AS last_timestamp,
     toString(has_meta) = 'true' AS has_meta, toString(has_full_snapshot) = 'true' AS has_full_snapshot, toString(payload_encoding) AS payload_encoding,
     CAST(chunk_bytes AS UInt32) AS chunk_bytes, CAST(payload_bytes AS UInt32) AS payload_bytes, toString(payload) AS payload, toString(source) AS source
   FROM ${recordings} WHERE toString(session_id) IN (${sessionList})
   ORDER BY recording_id, chunk_seq, part_index LIMIT 1 BY recording_id, chunk_seq, part_index`,
);
const byRecording = new Map<string, typeof parts>();
for (const part of parts) byRecording.set(String(part.recording_id), [...(byRecording.get(String(part.recording_id)) ?? []), part]);
const recordingResults = [...byRecording].map(([recordingId, rows]) => {
  const result = reassemble(rows.map((r) => ({ ...r, has_meta: Boolean(r.has_meta), has_full_snapshot: Boolean(r.has_full_snapshot) })) as unknown as RecordingChunkRow[]);
  return {
    recordingId,
    parts: rows.length,
    complete: result.complete,
    gaps: result.gaps,
    events: result.segments.reduce((n, s) => n + s.events.length, 0),
    startsWithSnapshot: result.segments[0]?.events[0]?.type === 4 && result.segments[0]?.events[1]?.type === 2,
  };
});
const sentinels = ["jane.doe@example.com", "sk_test_SENTINEL_123", "invite_token", "BLOCKED_SENTINEL_4242", "smoke.user@example.com"];
const [leaks] = await query<Record<string, number>>(
  `SELECT ${sentinels.map((s, i) => `countIf(position(toString(payload), '${s}') > 0) AS s${i}`).join(", ")} FROM ${recordings} WHERE toString(session_id) IN (${sessionList})`,
);

const summary = {
  acceptedEvents: ids.length,
  storedEventIds: storedIds.size,
  storedRows: stored.length,
  fieldMismatches: mismatches.length,
  mismatchExamples: mismatches.slice(0, 3),
  countsMatch: counts.every((c) => Number(c.events) === expectedCounts[c.event_name]) && counts.length === Object.keys(expectedCounts).length,
  counts,
  recordings: recordingResults,
  sentinelRowsInRecordings: Object.values(leaks).reduce((a, b) => a + Number(b), 0),
};
console.log(JSON.stringify(summary, null, 2));
const ok =
  summary.fieldMismatches === 0 &&
  summary.countsMatch &&
  recordingResults.length > 0 &&
  recordingResults.every((r) => r.complete && r.startsWithSnapshot) &&
  summary.sentinelRowsInRecordings === 0;
console.log(ok ? "PASS end-to-end RawTree verification" : "FAIL end-to-end RawTree verification");
if (!ok) process.exitCode = 1;
