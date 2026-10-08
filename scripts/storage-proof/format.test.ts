import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildChunks,
  planFetch,
  reassemble,
  type RecordingChunkRow,
  type RrwebEvent,
  RRWEB_EVENT_TYPE,
  splitUtf8,
  utf8Length,
} from "./format.ts";

const T = RRWEB_EVENT_TYPE;

function snapshotPair(timestamp: number, text = "page"): RrwebEvent[] {
  return [
    { type: T.Meta, timestamp, data: { href: "https://example.test/", width: 800, height: 600 } },
    { type: T.FullSnapshot, timestamp, data: { node: { type: 0, childNodes: [], text } } },
  ];
}

function incremental(timestamp: number, id: number): RrwebEvent {
  return { type: T.IncrementalSnapshot, timestamp, data: { source: 2, type: 2, id, x: id, y: id } };
}

/** Same timestamp everywhere: only the emission order can distinguish the events. */
function equalTimestampRecording(): RrwebEvent[] {
  const events = [...snapshotPair(1000)];
  for (let id = 1; id <= 40; id++) events.push(incremental(1000, id));
  events.push(...snapshotPair(1000, "checkout"));
  for (let id = 41; id <= 80; id++) events.push(incremental(1000, id));
  return events;
}

const options = { recordingId: "rec_test", sessionId: "ses_test", maxChunkBytes: 600, maxPartBytes: 4096 };

function shuffled<T>(items: readonly T[], seed = 7): T[] {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

describe("splitUtf8", () => {
  it("never cuts a multi-byte code point and round-trips exactly", () => {
    const value = "ab€😀ñ".repeat(50);
    for (const max of [4, 5, 6, 7, 13]) {
      const parts = splitUtf8(value, max);
      assert.equal(parts.join(""), value);
      for (const part of parts) assert.ok(utf8Length(part) <= max);
    }
  });
});

describe("buildChunks + reassemble", () => {
  it("starts a new chunk at every Meta event and respects part limits", () => {
    const rows = buildChunks(equalTimestampRecording(), options);
    for (const row of rows) assert.ok(row.payload_bytes <= options.maxPartBytes);
    const metaChunks = rows.filter((r) => r.has_meta);
    assert.equal(metaChunks.length, 2);
    for (const row of metaChunks) assert.ok(row.has_full_snapshot, "Meta and FullSnapshot share a chunk");
    assert.ok(new Set(rows.map((r) => r.chunk_seq)).size > 2, "size limit creates more chunks");
  });

  it("preserves emission order for equal timestamps despite shuffled, duplicated rows", () => {
    const events = equalTimestampRecording();
    const rows = buildChunks(events, options);
    const delivered = shuffled([...rows, ...rows.filter((_, i) => i % 3 === 0)]);
    const result = reassemble(delivered);
    assert.equal(result.complete, true);
    assert.equal(result.duplicateRows, Math.ceil(rows.length / 3));
    assert.equal(result.segments.length, 1, "one segment per contiguous run of chunks");
    assert.deepEqual(result.segments[0].events, events);
  });

  it("splits a large full snapshot into parts and reassembles it byte-for-byte", () => {
    // Pseudo-random text so that the gzip variant also needs several parts.
    let state = 1;
    const big = Array.from({ length: 20_000 }, () => {
      state = (state * 48271) % 2147483647;
      return ["x", "😀", "é", "<div>", String(state % 97)][state % 5];
    }).join("");
    const events = [...snapshotPair(1, big), incremental(2, 1)];
    for (const encoding of ["json", "gzip+base64"] as const) {
      const rows = buildChunks(events, { ...options, maxPartBytes: 1024, encoding });
      const snapshotRows = rows.filter((r) => r.chunk_seq === 0);
      assert.ok(snapshotRows.length > 1, `${encoding} snapshot uses several parts`);
      assert.deepEqual(reassemble(shuffled(rows)).segments.flatMap((s) => s.events), events);
    }
  });

  it("reports missing chunks and does not replay incremental events without a snapshot", () => {
    const events = equalTimestampRecording();
    const rows = buildChunks(events, options);
    const lastSeq = Math.max(...rows.map((r) => r.chunk_seq));
    const removed = 1;
    const result = reassemble(
      rows.filter((r) => r.chunk_seq !== removed),
      { firstChunkSeq: 0, lastChunkSeq: lastSeq },
    );
    assert.equal(result.complete, false);
    assert.deepEqual(result.gaps[0], { kind: "missing_chunks", fromChunkSeq: removed, toChunkSeq: removed });
    const checkoutSeq = rows.filter((r) => r.has_meta)[1].chunk_seq;
    const expectedUnreplayable = [];
    for (let seq = removed + 1; seq < checkoutSeq; seq++) expectedUnreplayable.push(seq);
    assert.deepEqual(result.unreplayableChunkSeqs, expectedUnreplayable);
    assert.equal(result.segments.length, 2);
    assert.equal(result.segments[1].startChunkSeq, checkoutSeq);
    assert.deepEqual(result.segments[1].events, events.slice(rows.find((r) => r.chunk_seq === checkoutSeq)?.event_seq_start));
  });

  it("reports missing trailing chunks only when the expected range is known", () => {
    const rows = buildChunks(equalTimestampRecording(), options);
    const lastSeq = Math.max(...rows.map((r) => r.chunk_seq));
    const truncated = rows.filter((r) => r.chunk_seq !== lastSeq);
    assert.equal(reassemble(truncated).complete, true);
    assert.equal(reassemble(truncated, { firstChunkSeq: 0, lastChunkSeq: lastSeq }).complete, false);
  });

  it("reports a missing part of a split chunk", () => {
    const events = [...snapshotPair(1, "y".repeat(10_000)), incremental(2, 1)];
    const rows = buildChunks(events, { ...options, maxPartBytes: 1024 });
    const result = reassemble(rows.filter((r) => !(r.chunk_seq === 0 && r.part_index === 2)));
    assert.deepEqual(result.gaps, [{ kind: "missing_parts", chunkSeq: 0, missingParts: [2] }]);
    assert.equal(result.segments.length, 0);
  });

  it("flags duplicates with different content as conflicts", () => {
    const rows = buildChunks(equalTimestampRecording(), options);
    const tampered: RecordingChunkRow = { ...rows[1], payload: rows[1].payload.replace("1000", "1001") };
    const result = reassemble([...rows, tampered]);
    assert.equal(result.conflictingDuplicates, 1);
    assert.equal(result.complete, false);
  });
});

describe("planFetch", () => {
  it("starts at the latest full snapshot before the window and honours the byte budget", () => {
    const events: RrwebEvent[] = [...snapshotPair(0)];
    for (let i = 1; i < 30; i++) events.push(incremental(i * 100, i));
    events.push(...snapshotPair(3000, "second"));
    for (let i = 31; i < 60; i++) events.push(incremental(i * 100, i));
    const rows = buildChunks(events, options);
    const second = rows.filter((r) => r.has_meta)[1];

    const inSecond = planFetch(rows, { fromTimestamp: 4000, toTimestamp: 4500, maxBytes: 1_000_000 });
    assert.equal(inSecond?.firstChunkSeq, second.chunk_seq);
    assert.equal(inSecond?.truncated, false);

    const budget = planFetch(rows, { fromTimestamp: 0, toTimestamp: 10_000, maxBytes: 1200 });
    assert.equal(budget?.firstChunkSeq, 0);
    assert.equal(budget?.truncated, true);
    assert.ok((budget?.plannedBytes ?? 0) <= 1200);
  });
});
