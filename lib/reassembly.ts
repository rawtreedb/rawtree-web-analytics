// Reader-side recording reassembly, moved from the milestone 0 storage proof
// (scripts/storage-proof/format.ts in the milestone 0 commit). Chunking lives in the
// SDK (`packages/analytics/src/chunker.ts`); this file only rebuilds recordings from
// stored rows.
//
// A recording is an ordered stream of rrweb events stored as chunk rows (one row per
// chunk part). Ordering comes from chunk_seq/part_index and the event emission
// sequence, never from timestamps. Rows may arrive duplicated or out of order; readers
// deduplicate by (chunk_seq, part_index) and report missing chunks or parts as gaps.
// Payloads are JSON strings ("json" encoding only, per the milestone 0 decision).

import type { RecordingRow } from "@rawtree/analytics/protocol";

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

/** The columns of a stored recording part that reassembly needs. */
export type ChunkRow = Pick<
  RecordingRow,
  | "recording_id"
  | "session_id"
  | "format_version"
  | "chunk_seq"
  | "part_index"
  | "part_count"
  | "event_seq_start"
  | "event_seq_end"
  | "event_count"
  | "first_timestamp"
  | "last_timestamp"
  | "has_meta"
  | "has_full_snapshot"
  | "payload_encoding"
  | "chunk_bytes"
  | "payload_bytes"
  | "payload"
>;

export type ChunkMetadata = Omit<ChunkRow, "payload">;

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
  rows: readonly ChunkRow[],
  expected?: { firstChunkSeq: number; lastChunkSeq: number },
): ReassembledRecording {
  if (rows.length === 0) throw new Error("No rows to reassemble");
  const recordingId = rows[0].recording_id;
  const unique = new Map<string, ChunkRow>();
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

  const chunks = new Map<number, ChunkRow[]>();
  for (const row of unique.values()) {
    const parts = chunks.get(row.chunk_seq) ?? [];
    parts.push(row);
    chunks.set(row.chunk_seq, parts);
  }

  const gaps: RecordingGap[] = [];
  const seqs = [...chunks.keys()].sort((a, b) => a - b);
  const first = expected?.firstChunkSeq ?? seqs[0];
  const last = expected?.lastChunkSeq ?? seqs[seqs.length - 1];

  type CompleteChunk = { seq: number; meta: ChunkMetadata; events: RrwebEvent[] };
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
    const ordered = Array.from({ length: partCount }, (_, i) => byIndex.get(i) as ChunkRow);
    const events = JSON.parse(ordered.map((p) => p.payload).join("")) as RrwebEvent[];
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
