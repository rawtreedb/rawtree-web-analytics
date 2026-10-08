// Candidate recording storage representation (milestone 0 proof).
//
// A recording is an ordered stream of rrweb events. It is stored as chunk rows:
// - A chunk holds consecutive events, identified by (recording_id, chunk_seq).
// - A new chunk always starts at an rrweb Meta event, so every full snapshot
//   (Meta + FullSnapshot) begins a chunk and replay can start at a chunk boundary.
// - A chunk payload larger than maxPartBytes is split into byte-bounded parts, each
//   stored as its own row, so one large full snapshot never needs one large request.
// - Every row repeats the metadata, so listing and planning reads never touch payloads.
//
// Ordering comes from chunk_seq/part_index and the event emission sequence, never from
// timestamps. Rows may arrive duplicated or out of order; readers deduplicate by
// (recording_id, chunk_seq, part_index) and report missing chunks or parts as gaps.

import { gunzipSync, gzipSync } from "node:zlib";

export const RECORDING_FORMAT_VERSION = 1;

export const RRWEB_EVENT_TYPE = {
  DomContentLoaded: 0,
  Load: 1,
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
  Plugin: 6,
} as const;

export type RrwebEvent = {
  type: number;
  timestamp: number;
  data?: unknown;
  [key: string]: unknown;
};

export type PayloadEncoding = "json" | "gzip+base64";

export type RecordingChunkRow = {
  format_version: number;
  recording_id: string;
  session_id: string;
  chunk_id: string;
  chunk_seq: number;
  part_index: number;
  part_count: number;
  event_seq_start: number;
  event_seq_end: number;
  event_count: number;
  first_timestamp: number;
  last_timestamp: number;
  has_meta: boolean;
  has_full_snapshot: boolean;
  payload_encoding: PayloadEncoding;
  chunk_bytes: number;
  payload_bytes: number;
  payload: string;
};

export type ChunkMetadata = Omit<RecordingChunkRow, "payload">;

export type BuildChunksOptions = {
  recordingId: string;
  sessionId: string;
  /** Soft target: start a new chunk before the serialized events would exceed this. */
  maxChunkBytes: number;
  /** Hard limit for the payload of one stored row. */
  maxPartBytes: number;
  encoding?: PayloadEncoding;
};

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8Length(value: string): number {
  return utf8.encode(value).byteLength;
}

/** Split UTF-8 text into parts of at most maxBytes without cutting a code point. */
export function splitUtf8(value: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new Error("maxBytes must allow a complete UTF-8 code point");
  const bytes = utf8.encode(value);
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + maxBytes, bytes.length);
    // Move back while the boundary byte is a UTF-8 continuation byte (10xxxxxx).
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(utf8Decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return parts.length > 0 ? parts : [""];
}

function encodePayload(json: string, encoding: PayloadEncoding): string {
  return encoding === "json" ? json : gzipSync(json).toString("base64");
}

function decodePayload(payload: string, encoding: PayloadEncoding): string {
  return encoding === "json" ? payload : gunzipSync(Buffer.from(payload, "base64")).toString("utf8");
}

export function buildChunks(events: readonly RrwebEvent[], options: BuildChunksOptions): RecordingChunkRow[] {
  const encoding = options.encoding ?? "json";
  const groups: { start: number; events: RrwebEvent[] }[] = [];
  let current: { start: number; events: RrwebEvent[]; bytes: number } | undefined;

  events.forEach((event, seq) => {
    const eventBytes = utf8Length(JSON.stringify(event)) + 1;
    const startsSnapshot = event.type === RRWEB_EVENT_TYPE.Meta;
    // Keep a FullSnapshot in the same chunk as the Meta event that precedes it.
    const continuesSnapshot =
      event.type === RRWEB_EVENT_TYPE.FullSnapshot &&
      current?.events[current.events.length - 1]?.type === RRWEB_EVENT_TYPE.Meta;
    if (
      current &&
      current.events.length > 0 &&
      (startsSnapshot || (!continuesSnapshot && current.bytes + eventBytes > options.maxChunkBytes))
    ) {
      groups.push(current);
      current = undefined;
    }
    current ??= { start: seq, events: [], bytes: 2 };
    current.events.push(event);
    current.bytes += eventBytes;
  });
  if (current) groups.push(current);

  return groups.flatMap((group, chunkSeq) => {
    const payload = encodePayload(JSON.stringify(group.events), encoding);
    const parts = splitUtf8(payload, options.maxPartBytes);
    const metadata = {
      format_version: RECORDING_FORMAT_VERSION,
      recording_id: options.recordingId,
      session_id: options.sessionId,
      chunk_seq: chunkSeq,
      part_count: parts.length,
      event_seq_start: group.start,
      event_seq_end: group.start + group.events.length - 1,
      event_count: group.events.length,
      first_timestamp: group.events[0].timestamp,
      last_timestamp: group.events[group.events.length - 1].timestamp,
      has_meta: group.events.some((e) => e.type === RRWEB_EVENT_TYPE.Meta),
      has_full_snapshot: group.events.some((e) => e.type === RRWEB_EVENT_TYPE.FullSnapshot),
      payload_encoding: encoding,
      chunk_bytes: utf8Length(payload),
    };
    return parts.map((part, partIndex) => ({
      ...metadata,
      chunk_id: `${options.recordingId}:${chunkSeq}:${partIndex}`,
      part_index: partIndex,
      payload_bytes: utf8Length(part),
      payload: part,
    }));
  });
}

export type RecordingGap =
  | { kind: "missing_chunks"; fromChunkSeq: number; toChunkSeq: number }
  | { kind: "missing_parts"; chunkSeq: number; missingParts: number[] }
  | { kind: "event_sequence"; afterEventSeq: number; nextEventSeq: number };

export type ReplaySegment = {
  startChunkSeq: number;
  endChunkSeq: number;
  startTimestamp: number;
  endTimestamp: number;
  events: RrwebEvent[];
};

export type ReassembledRecording = {
  recordingId: string;
  duplicateRows: number;
  conflictingDuplicates: number;
  gaps: RecordingGap[];
  /** Complete chunks that cannot be replayed because no earlier full snapshot survives. */
  unreplayableChunkSeqs: number[];
  segments: ReplaySegment[];
  complete: boolean;
};

/**
 * Rebuild replayable segments from stored rows in any order, with duplicates.
 * Pass the expected chunk range when known (for example from a metadata query) so
 * that missing leading or trailing chunks are reported too.
 */
export function reassemble(
  rows: readonly RecordingChunkRow[],
  expected?: { firstChunkSeq: number; lastChunkSeq: number },
): ReassembledRecording {
  if (rows.length === 0) throw new Error("No rows to reassemble");
  const recordingId = rows[0].recording_id;
  const unique = new Map<string, RecordingChunkRow>();
  let duplicateRows = 0;
  let conflictingDuplicates = 0;
  for (const row of rows) {
    if (row.recording_id !== recordingId) throw new Error("Rows from several recordings");
    if (row.format_version !== RECORDING_FORMAT_VERSION) {
      throw new Error(`Unsupported recording format ${row.format_version}`);
    }
    const key = `${row.chunk_seq}:${row.part_index}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, row);
      continue;
    }
    duplicateRows++;
    if (existing.payload !== row.payload || existing.part_count !== row.part_count) conflictingDuplicates++;
  }

  const chunks = new Map<number, RecordingChunkRow[]>();
  for (const row of unique.values()) {
    const parts = chunks.get(row.chunk_seq) ?? [];
    parts.push(row);
    chunks.set(row.chunk_seq, parts);
  }

  const gaps: RecordingGap[] = [];
  const seqs = [...chunks.keys()].sort((a, b) => a - b);
  const first = expected?.firstChunkSeq ?? seqs[0];
  const last = expected?.lastChunkSeq ?? seqs[seqs.length - 1];

  type CompleteChunk = { seq: number; meta: RecordingChunkRow; events: RrwebEvent[] };
  const complete: (CompleteChunk | undefined)[] = [];
  for (let seq = first; seq <= last; seq++) {
    const parts = chunks.get(seq);
    if (!parts) {
      const previous = gaps[gaps.length - 1];
      if (previous?.kind === "missing_chunks" && previous.toChunkSeq === seq - 1) previous.toChunkSeq = seq;
      else gaps.push({ kind: "missing_chunks", fromChunkSeq: seq, toChunkSeq: seq });
      complete.push(undefined);
      continue;
    }
    const partCount = parts[0].part_count;
    const byIndex = new Map(parts.map((p) => [p.part_index, p]));
    const missingParts = Array.from({ length: partCount }, (_, i) => i).filter((i) => !byIndex.has(i));
    if (missingParts.length > 0 || parts.some((p) => p.part_count !== partCount)) {
      gaps.push({ kind: "missing_parts", chunkSeq: seq, missingParts });
      complete.push(undefined);
      continue;
    }
    const ordered = Array.from({ length: partCount }, (_, i) => byIndex.get(i) as RecordingChunkRow);
    const events = JSON.parse(decodePayload(ordered.map((p) => p.payload).join(""), ordered[0].payload_encoding));
    if (!Array.isArray(events) || events.length !== ordered[0].event_count) {
      throw new Error(`Chunk ${seq} event count does not match its metadata`);
    }
    complete.push({ seq, meta: ordered[0], events });
  }

  const segments: ReplaySegment[] = [];
  const unreplayableChunkSeqs: number[] = [];
  let segment: ReplaySegment | undefined;
  let previous: CompleteChunk | undefined;
  for (const chunk of complete) {
    if (!chunk) {
      segment = undefined;
      previous = undefined;
      continue;
    }
    if (previous && chunk.meta.event_seq_start !== previous.meta.event_seq_end + 1) {
      gaps.push({
        kind: "event_sequence",
        afterEventSeq: previous.meta.event_seq_end,
        nextEventSeq: chunk.meta.event_seq_start,
      });
      segment = undefined;
    }
    previous = chunk;
    if (!segment) {
      if (!(chunk.meta.has_meta && chunk.meta.has_full_snapshot)) {
        unreplayableChunkSeqs.push(chunk.seq);
        continue;
      }
      segment = {
        startChunkSeq: chunk.seq,
        endChunkSeq: chunk.seq,
        startTimestamp: chunk.meta.first_timestamp,
        endTimestamp: chunk.meta.last_timestamp,
        events: [],
      };
      segments.push(segment);
    }
    segment.events.push(...chunk.events);
    segment.endChunkSeq = chunk.seq;
    segment.endTimestamp = chunk.meta.last_timestamp;
  }

  return {
    recordingId,
    duplicateRows,
    conflictingDuplicates,
    gaps,
    unreplayableChunkSeqs,
    segments,
    complete: gaps.length === 0 && unreplayableChunkSeqs.length === 0 && conflictingDuplicates === 0,
  };
}

export type FetchPlan = {
  firstChunkSeq: number;
  lastChunkSeq: number;
  plannedBytes: number;
  truncated: boolean;
};

/**
 * Choose the chunk range needed to replay [fromTimestamp, toTimestamp] within a byte
 * budget. The range starts at the latest full-snapshot chunk at or before the start.
 * metadata must contain one deduplicated row per chunk part.
 */
export function planFetch(
  metadata: readonly ChunkMetadata[],
  window: { fromTimestamp: number; toTimestamp: number; maxBytes: number },
): FetchPlan | undefined {
  const chunks = new Map<number, ChunkMetadata>();
  for (const row of metadata) if (!chunks.has(row.chunk_seq)) chunks.set(row.chunk_seq, row);
  const ordered = [...chunks.values()].sort((a, b) => a.chunk_seq - b.chunk_seq);
  const snapshotStarts = ordered.filter(
    (c) => c.has_meta && c.has_full_snapshot && c.first_timestamp <= window.fromTimestamp,
  );
  const start = snapshotStarts[snapshotStarts.length - 1] ?? ordered.find((c) => c.has_meta && c.has_full_snapshot);
  if (!start) return undefined;

  let lastChunkSeq = start.chunk_seq;
  let plannedBytes = 0;
  let truncated = false;
  for (const chunk of ordered) {
    if (chunk.chunk_seq < start.chunk_seq) continue;
    if (chunk.chunk_seq > start.chunk_seq && chunk.first_timestamp > window.toTimestamp) break;
    if (plannedBytes + chunk.chunk_bytes > window.maxBytes && chunk.chunk_seq !== start.chunk_seq) {
      truncated = true;
      break;
    }
    plannedBytes += chunk.chunk_bytes;
    lastChunkSeq = chunk.chunk_seq;
  }
  return { firstChunkSeq: start.chunk_seq, lastChunkSeq, plannedBytes, truncated };
}
