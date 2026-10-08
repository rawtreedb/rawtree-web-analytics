// Server-only RawTree HTTP client with fixed, configured destinations.

import { createHash } from "node:crypto";

export type RawTreeIngestConfig = {
  apiUrl: string;
  database: string;
  ingestKey: string;
  /** Prefix for table names, e.g. "e2e_" for disposable test tables. Empty in production. */
  tablePrefix: string;
};

export class RawTreeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Insert rows into one table and resolve only after RawTree acknowledges every row.
 * The deduplication token makes an identical retry a no-op within RawTree's dedup window;
 * readers still deduplicate by ID because that window is bounded (about one hour).
 */
export async function insertRows(
  config: RawTreeIngestConfig,
  table: "events" | "recordings",
  rows: { event_id?: string; chunk_id?: string }[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (rows.length === 0) return;
  const token = createHash("sha256")
    .update(`${table}\n${rows.map((row) => row.event_id ?? row.chunk_id).join("\n")}`)
    .digest("hex");
  const params = new URLSearchParams({
    database: config.database,
    deduplicate_insert: "enable",
    insert_deduplication_token: token,
  });
  const response = await fetchImpl(`${config.apiUrl}/v1/tables/${config.tablePrefix}${table}?${params}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.ingestKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new RawTreeError(`RawTree insert into ${table} failed: ${text.slice(0, 300)}`, response.status);
  // A deduplicated retry may report fewer rows than sent; anything else must match.
  const inserted = (JSON.parse(text) as { inserted?: unknown }).inserted;
  if (typeof inserted !== "number" || inserted > rows.length) {
    throw new RawTreeError(`RawTree acknowledged ${String(inserted)} of ${rows.length} rows in ${table}`, 502);
  }
}
