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
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Split UTF-8 text into parts of at most maxBytes without cutting a code point. */
export function splitUtf8(value: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new Error("maxBytes must allow a complete UTF-8 code point");
  const bytes = encoder.encode(value);
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + maxBytes, bytes.length);
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return parts.length > 0 ? parts : [""];
}

export class RecordingChunker {
  readonly recordingId: string;
  private readonly maxChunkBytes: number;
  private readonly maxPartPayloadBytes: number;
  private events: RrwebEvent[] = [];
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
    const eventBytes = utf8Length(JSON.stringify(event)) + 1;
    const last = this.events[this.events.length - 1];
    const continuesSnapshot = event.type === FULL_SNAPSHOT && last?.type === META;
    const closed: RecordingPartInput[] = [];
    if (this.events.length > 0 && (event.type === META || (!continuesSnapshot && this.bytes + eventBytes > this.maxChunkBytes))) {
      closed.push(...this.flush(sessionId));
    }
    if (this.events.length === 0) this.chunkStartSeq = this.nextEventSeq;
    this.events.push(event);
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
    const payload = JSON.stringify(events);
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
      chunk_bytes: utf8Length(payload),
    };
    this.events = [];
    this.bytes = 2;
    return parts.map((part, partIndex) => ({ ...base, part_index: partIndex, payload: part }));
  }
}
