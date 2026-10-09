// Streaming rrweb chunker. Produces the recording format proven in milestone 0:
// - a new chunk starts at every rrweb Meta event, and the FullSnapshot that follows
//   stays in the same chunk, so replay can start at any snapshot chunk;
// - a chunk closes when it reaches maxChunkBytes or when the owner flushes it;
// - a chunk payload is the JSON array of its events, split into UTF-8-safe parts.
// Ordering is carried by chunk_seq, part_index, and the emission sequence, never by time.

import { LIMITS, type RecordingPartInput, utf8Length } from "./protocol.ts";

export type RrwebEvent = { type: number; timestamp: number; [key: string]: unknown };

const META = 4;
const FULL_SNAPSHOT = 2;

/**
 * Split UTF-8 text into parts of at most maxBytes without cutting a code point.
 * Walks code units instead of encoding and decoding the whole string. A lone surrogate
 * (never present in JSON.stringify output) counts as the 3-byte U+FFFD it encodes to.
 */
export function splitUtf8(value: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new Error("maxBytes must allow a complete UTF-8 code point");
  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    let size = 3;
    let units = 1;
    if (c < 0x80) size = 1;
    else if (c < 0x800) size = 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length && (value.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      size = 4;
      units = 2;
    }
    if (bytes + size > maxBytes) {
      parts.push(value.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
    i += units - 1;
  }
  if (start < value.length) parts.push(value.slice(start));
  return parts.length > 0 ? parts : [""];
}

export class RecordingChunker {
  readonly recordingId: string;
  private readonly maxChunkBytes: number;
  private readonly maxPartPayloadBytes: number;
  private events: RrwebEvent[] = [];
  /** JSON of each open event, kept from push so the chunk is serialized once. */
  private json: string[] = [];
  private bytes = 2;
  private chunkStartSeq = 0;
  private nextEventSeq = 0;
  private nextChunkSeq = 0;

  constructor(options: { recordingId: string; maxChunkBytes?: number; maxPartPayloadBytes?: number }) {
    this.recordingId = options.recordingId;
    this.maxChunkBytes = options.maxChunkBytes ?? 64 * 1024;
    this.maxPartPayloadBytes = Math.min(options.maxPartPayloadBytes ?? LIMITS.maxPartPayloadBytes, LIMITS.maxPartPayloadBytes);
  }

  get hasOpenChunk(): boolean {
    return this.events.length > 0;
  }

  /** Add one emitted rrweb event. Returns the parts of any chunk that closed. */
  push(event: RrwebEvent, sessionId: string): RecordingPartInput[] {
    const json = JSON.stringify(event);
    const eventBytes = utf8Length(json) + 1;
    const last = this.events[this.events.length - 1];
    const continuesSnapshot = event.type === FULL_SNAPSHOT && last?.type === META;
    const closed: RecordingPartInput[] = [];
    if (this.events.length > 0 && (event.type === META || (!continuesSnapshot && this.bytes + eventBytes > this.maxChunkBytes))) {
      closed.push(...this.flush(sessionId));
    }
    if (this.events.length === 0) this.chunkStartSeq = this.nextEventSeq;
    this.events.push(event);
    this.json.push(json);
    this.bytes += eventBytes;
    this.nextEventSeq++;
    // Close full chunks right away, but never between a Meta event and its snapshot.
    if (this.bytes >= this.maxChunkBytes && event.type !== META) closed.push(...this.flush(sessionId));
    return closed;
  }

  /** Close the open chunk, if any, and return its parts. */
  flush(sessionId: string): RecordingPartInput[] {
    if (this.events.length === 0) return [];
    const events = this.events;
    // Equals JSON.stringify(events) byte for byte.
    const payload = `[${this.json.join(",")}]`;
    const parts = splitUtf8(payload, this.maxPartPayloadBytes);
    const chunkSeq = this.nextChunkSeq++;
    const base = {
      recording_id: this.recordingId,
      session_id: sessionId,
      chunk_seq: chunkSeq,
      part_count: parts.length,
      event_seq_start: this.chunkStartSeq,
      event_seq_end: this.chunkStartSeq + events.length - 1,
      event_count: events.length,
      first_timestamp: Math.trunc(events[0].timestamp),
      last_timestamp: Math.trunc(Math.max(...events.map((e) => e.timestamp))),
      has_meta: events.some((e) => e.type === META),
      has_full_snapshot: events.some((e) => e.type === FULL_SNAPSHOT),
      chunk_bytes: this.bytes - 1, // "[" + "]" + each event plus its comma, minus the missing last comma
    };
    this.events = [];
    this.json = [];
    this.bytes = 2;
    return parts.map((part, partIndex) => ({ ...base, part_index: partIndex, payload: part }));
  }
}
