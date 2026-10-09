// Storage check for the test console: how many rows RawTree holds for the given event IDs
// and recording IDs, read with the visitor's credentials. Only validated IDs come from the
// browser; the SQL and table names are fixed here. Body: { eventIds, recordingIds }.

import { getAccess } from "../../../../lib/access.ts";
import { isMissingTable, RawTreeError, runQuery, tableName } from "../../../../lib/rawtree.ts";

const ID = /^[A-Za-z0-9_:.\-]{1,128}$/;
const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && ID.test(id)).slice(0, 500) : []);
const inList = (list: string[]) => list.map((id) => `'${id}'`).join(", "); // safe: IDs match ID
const orEmpty = (error: unknown) => {
  if (isMissingTable(error)) return []; // RawTree creates a table with its first insert
  throw error;
};

export async function POST(request: Request): Promise<Response> {
  const access = await getAccess();
  if (!access) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { eventIds?: unknown; recordingIds?: unknown };
  const eventIds = ids(body.eventIds);
  const recordingIds = ids(body.recordingIds);
  // Bound the event scan: the console polls events for 30 s after sending them. Recordings stay
  // unbounded because one recording's parts can span longer than any window.
  const recent = `AND CAST(received_at_ms AS Int64) > ${Date.now() - 10 * 60_000}`;
  try {
    const [eventRows, recordingRows] = await Promise.all([
      eventIds.length === 0
        ? []
        : runQuery<{ id: string; n: number }>(
            access.query,
            `SELECT toString(event_id) AS id, count() AS n FROM ${tableName(access.query, "events")} WHERE toString(event_id) IN (${inList(eventIds)}) ${recent} GROUP BY id`,
          ).catch(orEmpty),
      recordingIds.length === 0
        ? []
        : runQuery<{ id: string; parts: number; unique_parts: number }>(
            access.query,
            `SELECT toString(recording_id) AS id, count() AS parts, uniqExact(CAST(chunk_seq AS UInt32), CAST(part_index AS UInt32)) AS unique_parts FROM ${tableName(access.query, "recordings")} WHERE toString(recording_id) IN (${inList(recordingIds)}) GROUP BY id`,
          ).catch(orEmpty),
    ]);
    return Response.json({
      events: Object.fromEntries(eventRows.map((row) => [row.id, row.n])),
      recordings: Object.fromEntries(recordingRows.map((row) => [row.id, { parts: row.parts, uniqueParts: row.unique_parts }])),
    });
  } catch (error) {
    const status = error instanceof RawTreeError && error.status === 401 ? 401 : 502;
    console.error(`console storage check failed: HTTP ${error instanceof RawTreeError ? error.status : "error"}`);
    return Response.json({ error: "query_failed" }, { status });
  }
}
