import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RecordingChunker, type RrwebEvent, splitUtf8 } from "../src/chunker.ts";
import { utf8Length } from "../src/protocol.ts";
import { jsonStringLength } from "../src/util.ts";

const meta = (t: number): RrwebEvent => ({ type: 4, timestamp: t, data: { href: "https://a.test/", width: 1, height: 1 } });
const snapshot = (t: number, size = 10): RrwebEvent => ({ type: 2, timestamp: t, data: { node: { text: "x".repeat(size) } } });
const move = (t: number): RrwebEvent => ({ type: 3, timestamp: t, data: { source: 1, positions: [{ x: t, y: t }] } });

describe("splitUtf8", () => {
  it("never cuts a code point", () => {
    const value = "a€😀ñ".repeat(100);
    for (const max of [4, 5, 7, 11]) {
      const parts = splitUtf8(value, max);
      assert.equal(parts.join(""), value);
      for (const p of parts) assert.ok(utf8Length(p) <= max);
    }
  });
});

describe("RecordingChunker", () => {
  it("starts chunks at Meta, keeps the snapshot with it, and keeps sequence ranges contiguous", () => {
    const chunker = new RecordingChunker({ recordingId: "rec", maxChunkBytes: 300 });
    const events = [meta(1), snapshot(1, 1000), move(2), move(3), move(4), meta(5), snapshot(5), move(6)];
    const parts = events.flatMap((e) => chunker.push(e, "ses"));
    parts.push(...chunker.flush("ses"));
    const chunks = [...new Map(parts.map((p) => [p.chunk_seq, p])).values()];
    assert.equal(chunks[0].has_meta && chunks[0].has_full_snapshot, true, "Meta and its snapshot share chunk 0");
    assert.equal(chunks[0].event_count, 2, "an oversized snapshot chunk closes immediately");
    const second = chunks.filter((c) => c.has_meta)[1];
    assert.ok(second.has_full_snapshot);
    for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].event_seq_start, chunks[i - 1].event_seq_end + 1);
    const replayed = chunks.flatMap((c) => JSON.parse(parts.filter((p) => p.chunk_seq === c.chunk_seq).map((p) => p.payload).join("")));
    assert.deepEqual(replayed, events);
  });

  it("splits large chunks into byte-bounded parts", () => {
    const chunker = new RecordingChunker({ recordingId: "rec", maxPartPayloadBytes: 1000 });
    const parts = [...chunker.push(meta(1), "ses"), ...chunker.push(snapshot(1, 5000), "ses"), ...chunker.flush("ses")];
    assert.ok(parts.length > 5);
    for (const p of parts) assert.ok(utf8Length(p.payload) <= 1000);
    assert.deepEqual(new Set(parts.map((p) => p.part_count)), new Set([parts.length]));
  });

  it("sends exactly JSON.stringify(events), split on byte limits, with exact byte counts", () => {
    const text = 'a "q" \\ \n\t\u0001 € ñ 中文 😀 \ud800';
    const events = [meta(1), { ...snapshot(1), text }, ...Array.from({ length: 50 }, (_, i) => ({ ...move(i + 2), text: text.repeat(i) }))];
    const chunker = new RecordingChunker({ recordingId: "rec", maxChunkBytes: 1e9, maxPartPayloadBytes: 333 });
    const parts = [...events.flatMap((e) => chunker.push(e, "ses")), ...chunker.flush("ses")];
    const expected = JSON.stringify(events);
    const bytes = new TextEncoder().encode(expected);
    assert.equal(parts.map((p) => p.payload).join(""), expected);
    assert.equal(parts[0].chunk_bytes, bytes.length);
    for (const p of parts.slice(0, -1)) assert.ok(utf8Length(p.payload) > 333 - 4, "parts are filled greedily");
    assert.equal(jsonStringLength(text), utf8Length(JSON.stringify(text)));
    for (const p of parts) {
      assert.ok(utf8Length(p.payload) <= 333);
      assert.equal(utf8Length(p.payload), new TextEncoder().encode(p.payload).length);
      assert.equal(jsonStringLength(p.payload), utf8Length(JSON.stringify(p.payload)));
    }
  });

  it("returns nothing when flushing an empty chunk", () => {
    assert.deepEqual(new RecordingChunker({ recordingId: "rec" }).flush("ses"), []);
  });
});
