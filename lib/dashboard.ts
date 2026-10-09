// Dashboard data: runs the SQL in lib/queries.ts with the visitor's read config
// (Access.query from lib/access.ts) and returns typed rows for the pages. Pages import only this module (no SQL, no RawTree client).

import * as Q from "./queries.ts";
import { previousRange, type Range } from "./range.ts";
import { isMissingTable, RawTreeError, runQuery, tableName, type RawTreeConfig } from "./rawtree.ts";
import { planFetch, reassemble, type ChunkPlanRow, type ChunkRow, type RecordingGap } from "./reassembly.ts";

/** The message a page shows for a failed query: RawTree's own error, or `fallback` (and a server log). */
export function queryErrorMessage(
  error: unknown,
  fallback = "Could not reach RawTree. Check the server logs and the RawTree configuration.",
): string {
  if (error instanceof RawTreeError) return error.message;
  console.error("RawTree query failed", error);
  return fallback;
}

/** Await an object of promises in parallel, keeping the names. */
async function all<P extends Record<string, Promise<unknown>>>(promises: P): Promise<{ [K in keyof P]: Awaited<P[K]> }> {
  const values = await Promise.all(Object.values(promises));
  return Object.fromEntries(Object.keys(promises).map((key, index) => [key, values[index]])) as { [K in keyof P]: Awaited<P[K]> };
}

// --- Dashboard ------------------------------------------------------------------
// Row types mirror the SQL aliases in lib/queries.ts.

/** Humans-only counts plus bot counts (see HUMAN_AND_BOT_COUNTS). */
type Counts = { events: number; pageViews: number; sessions: number; visitors: number; botEvents: number; botPageViews: number };
export type Totals = Counts & { allEvents: number; allPageViews: number; allSessions: number; allVisitors: number };
export type DayRow = Counts & { dayMs: number };
type PageRow = { path: string; pageViews: number; visitors: number };
type TimeStats = { views: number; medianMs: number; p75Ms: number; engagedViews: number; quickExits: number };
type ScrollStats = { views: number; reached25: number; reached50: number; reached75: number; reached100: number };

export type DashboardData = NonNullable<Awaited<ReturnType<typeof getDashboard>>>;

/** Every dashboard section for one window and its previous period, queried in parallel. */
export async function getDashboard(range: Range, config: RawTreeConfig, fetchImpl?: typeof fetch) {
  const run = <T>(sql: string) => runQuery<T>(config, sql, fetchImpl);
  const one = async <T>(sql: string) => (await run<T>(sql))[0]!; // aggregates without GROUP BY return one row
  const table = tableName(config, "events");
  // Columns appear with the first event that carries them; the queries read missing ones as NULL.
  // Before the first event there is no table at all: return null for "no data yet".
  const columnRows = await run<{ name: string }>(Q.columnsSql(table)).catch((error) => {
    if (isMissingTable(error)) return null;
    throw error;
  });
  if (!columnRows) return null;
  const columns = new Set(columnRows.map((row) => row.name));
  const scope = (window: Range): Q.Scope => ({ table, columns, ...window });
  const period = (window: Range) =>
    all({
      totals: one<Totals>(Q.overview(scope(window))),
      daily: run<DayRow>(Q.daily(scope(window))),
      topPages: run<PageRow>(Q.topPages(scope(window))),
    });
  const s = scope(range);
  return {
    /** False until an event stores a user agent: bots cannot be told apart yet. */
    hasUserAgent: columns.has("user_agent"),
    /** False until an event stores a referrer: no acquisition data yet. */
    hasReferrer: columns.has("referrer"),
    ...(await all({
      current: period(range),
      previous: period(previousRange(range)),
      channels: run<{ channel: string; sessions: number }>(Q.channels(s)),
      referrers: run<{ referrer: string; channel: string; sessions: number }>(Q.referrers(s)),
      campaigns: run<{ source: string; medium: string; campaign: string; sessions: number }>(Q.campaigns(s)),
      timeTotals: one<TimeStats>(Q.timeOnPageTotals(s)),
      timeOnPage: run<TimeStats & { path: string }>(Q.timeOnPage(s)),
      scrollTotals: one<ScrollStats>(Q.scrollDepthTotals(s)),
      scroll: run<ScrollStats & { path: string }>(Q.scrollDepth(s)),
      ctas: run<{ ctaId: string; placement: string; clicks: number }>(Q.ctaClicks(s)),
      botAgents: run<{ userAgent: string; hits: number }>(Q.botAgents(s)),
      botPaths: run<{ path: string; requests: number }>(Q.botPaths(s)),
    })),
  };
}

// --- Recordings -------------------------------------------------------------------

type SummaryRow = {
  recordingId: string;
  sessionId: string;
  startMs: number;
  endMs: number;
  lastReceivedMs: number;
  minSeq: number;
  maxSeq: number;
  chunks: number;
  uniqueParts: number;
  declaredParts: number;
  bytes: number;
};

export type RecordingListItem = Omit<SummaryRow, "minSeq" | "maxSeq" | "uniqueParts" | "declaredParts"> & {
  complete: boolean;
  /** Incomplete but received seconds ago: RawTree reads lag writes briefly. */
  arriving: boolean;
};

/**
 * Complete when chunks run from 0 with no missing chunk seq and every declared part is
 * stored (counted once). An incomplete recording received within 2 minutes may still be arriving.
 */
export function toRecording(
  { minSeq, maxSeq, uniqueParts, declaredParts, ...row }: SummaryRow,
  nowMs = Date.now(),
): RecordingListItem {
  const complete = minSeq === 0 && row.chunks === maxSeq + 1 && uniqueParts === declaredParts;
  return { ...row, complete, arriving: !complete && nowMs - row.lastReceivedMs < 120_000 };
}

// Recording IDs come from URLs; only well-formed IDs reach SQL text.
function validateRecordingId(recordingId: string): string {
  if (!/^[A-Za-z0-9_:.\-]{1,128}$/.test(recordingId)) {
    throw new RawTreeError(`Invalid recording id: ${recordingId.slice(0, 32)}`, 400);
  }
  return recordingId;
}

/** The newest recording's ID, or undefined when there is none (including before the first recording). */
export async function getLatestRecordingId(config: RawTreeConfig): Promise<string | undefined> {
  try {
    return (await runQuery<{ recordingId: string }>(config, Q.latestRecording(tableName(config, "recordings"))))[0]?.recordingId;
  } catch (error) {
    if (isMissingTable(error)) return undefined;
    throw error;
  }
}

/** One recording's summary (undefined when not stored) and the 50 newest recordings. */
export async function getRecording(recordingId: string, config: RawTreeConfig) {
  const table = tableName(config, "recordings");
  const id = validateRecordingId(recordingId);
  const { summary, list } = await all({
    summary: runQuery<SummaryRow>(config, Q.recordingSummary(table, id)),
    list: runQuery<SummaryRow>(config, Q.recordingList(table)),
  });
  return { recording: summary[0] && toRecording(summary[0]), recordings: list.map((row) => toRecording(row)) };
}

/**
 * Largest payload response for one player fetch. RawTree allows 100 MiB results, but
 * the player only needs the first minutes, and a bounded fetch keeps a runaway
 * recording from stalling a request.
 */
const MAX_REPLAY_BYTES = 2_000_000;

type ReplayPayload = {
  recordingId: string;
  complete: boolean;
  gaps: string[];
  truncated: boolean;
  segments: { startTimestamp: number; endTimestamp: number; events: unknown[] }[];
};

/**
 * Fetch one recording for replay: chunk metadata first, then only the payload rows of the
 * chunk range chosen by planFetch (bounded in bytes, starting at a full snapshot).
 * Reassembly reports gaps instead of replaying across them.
 */
export async function getReplay(recordingId: string, config: RawTreeConfig, fetchImpl?: typeof fetch): Promise<ReplayPayload> {
  const table = tableName(config, "recordings");
  const id = validateRecordingId(recordingId);
  const metadata = await runQuery<ChunkPlanRow>(config, Q.chunkMetadata(table, id), fetchImpl);
  if (metadata.length === 0) throw new RawTreeError(`Recording ${recordingId} not found`, 404);
  const plan = planFetch(metadata, {
    fromTimestamp: metadata[0]!.first_timestamp,
    toTimestamp: metadata[metadata.length - 1]!.last_timestamp,
    maxBytes: MAX_REPLAY_BYTES,
  });
  if (!plan) return { recordingId, complete: false, gaps: ["no full snapshot to start replay"], truncated: false, segments: [] };

  const rows = await runQuery<ChunkRow>(config, Q.chunkPayloads(table, id, plan.firstChunkSeq, plan.lastChunkSeq), fetchImpl);
  const reassembled = reassemble(rows, { firstChunkSeq: plan.firstChunkSeq, lastChunkSeq: plan.lastChunkSeq });
  return {
    recordingId,
    complete: reassembled.complete,
    gaps: reassembled.gaps.map(describeGap),
    truncated: plan.truncated,
    segments: reassembled.segments,
  };
}

function describeGap(gap: RecordingGap): string {
  switch (gap.kind) {
    case "missing_chunks":
      return gap.fromChunkSeq === gap.toChunkSeq
        ? `Missing chunk ${gap.fromChunkSeq}`
        : `Missing chunks ${gap.fromChunkSeq}-${gap.toChunkSeq}`;
    case "missing_parts":
      return `Chunk ${gap.chunkSeq} is missing part${gap.missingParts.length > 1 ? "s" : ""} ${gap.missingParts.join(", ")}`;
    case "event_sequence":
      return `Event sequence jumps from ${gap.afterEventSeq} to ${gap.nextEventSeq}`;
  }
}
