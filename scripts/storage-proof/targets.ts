// Minimal storage clients for the proof: hosted RawTree over its public HTTP API, and a
// local ClickHouse server that mimics RawTree's `__raw_data` JSON rows for offline runs.
// Both accept the same row objects and the same SQL (bare top-level field names).

export type QueryResult<T> = { rows: T[]; ms: number; statistics?: unknown };

export type StorageTarget = {
  name: "clickhouse" | "rawtree";
  /** Insert rows in one request. Throws unless every row is acknowledged. */
  insert(table: string, rows: object[], options?: { dedupToken?: string }): Promise<{ ms: number; bytes: number }>;
  query<T>(sql: string): Promise<QueryResult<T>>;
};

export const TABLES = ["events", "recordings", "recordings_gzip"] as const;

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
}

async function ensureOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`${what} failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

// Top-level fields exposed as Dynamic aliases so bare names work like RawTree columns.
const LOCAL_FIELDS: Record<(typeof TABLES)[number], string[]> = {
  events: ["v", "event_id", "event_name", "occurred_at_ms", "received_at_ms", "session_id", "anonymous_id", "user_id"],
  recordings: [
    "format_version", "recording_id", "session_id", "chunk_id", "chunk_seq", "part_index", "part_count",
    "event_seq_start", "event_seq_end", "event_count", "first_timestamp", "last_timestamp", "has_meta",
    "has_full_snapshot", "payload_encoding", "chunk_bytes", "payload_bytes", "payload",
  ],
  recordings_gzip: [],
};
LOCAL_FIELDS.recordings_gzip = LOCAL_FIELDS.recordings;

export function localClickHouse(url = process.env.CLICKHOUSE_URL ?? "http://localhost:18123"): StorageTarget & {
  reset(database: string): Promise<void>;
  storage(table: string): Promise<{ rows: number; bytesOnDisk: number }>;
} {
  let database = "rwa_proof";
  const settings = {
    allow_experimental_json_type: "1",
    allow_experimental_dynamic_type: "1",
    output_format_json_quote_64bit_integers: "0",
  };
  const exec = async (sql: string, body?: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ database, ...settings, ...extra, query: sql });
    return ensureOk(await fetch(`${url}/?${params}`, { method: "POST", body: body ?? "" }), sql.slice(0, 80));
  };
  return {
    name: "clickhouse",
    async reset(name) {
      database = "default";
      await exec(`DROP DATABASE IF EXISTS ${name}`);
      await exec(`CREATE DATABASE ${name}`);
      database = name;
      for (const table of TABLES) {
        const aliases = LOCAL_FIELDS[table].map((f) => `, ${f} Dynamic ALIAS getSubcolumn(__raw_data, '${f}')`).join("");
        await exec(
          `CREATE TABLE ${table} (__raw_data JSON${aliases}) ENGINE = MergeTree ORDER BY tuple() SETTINGS non_replicated_deduplication_window = 1000`,
        );
      }
    },
    async insert(table, rows, options = {}) {
      const body = rows.map((row) => JSON.stringify({ __raw_data: row })).join("\n");
      // Mirror RawTree's default (deduplicate_insert=disable) unless a token is supplied.
      const extra: Record<string, string> = options.dedupToken
        ? { insert_deduplicate: "1", insert_deduplication_token: options.dedupToken }
        : { insert_deduplicate: "0" };
      const [, ms] = await timed(() => exec(`INSERT INTO ${table} FORMAT JSONEachRow`, body, extra));
      return { ms, bytes: Buffer.byteLength(body) };
    },
    async query<T>(sql: string) {
      const [response, ms] = await timed(async () => (await exec(`${sql} FORMAT JSON`)).json());
      const json = response as { data: T[]; statistics?: unknown };
      return { rows: json.data, ms, statistics: json.statistics };
    },
    async storage(table) {
      // bytes_on_disk: data_compressed_bytes under-reports JSON subcolumn files in 24.10.
      const { rows } = await this.query<{ r: number; b: number }>(
        `SELECT sum(rows) AS r, sum(bytes_on_disk) AS b FROM system.parts WHERE database = '${database}' AND table = '${table}' AND active`,
      );
      return { rows: Number(rows[0].r), bytesOnDisk: Number(rows[0].b) };
    },
  };
}

export function hostedRawTree(env = process.env): StorageTarget {
  const apiUrl = env.RAWTREE_API_URL ?? "https://api.rawtree.com";
  const database = env.RAWTREE_DATABASE;
  const ingestKey = env.RAWTREE_INGEST_KEY;
  const queryKey = env.RAWTREE_QUERY_KEY;
  if (!database || !ingestKey || !queryKey) {
    throw new Error("Set RAWTREE_DATABASE, RAWTREE_INGEST_KEY, and RAWTREE_QUERY_KEY (role-bound keys from rawtree-setup.ts)");
  }
  return {
    name: "rawtree",
    async insert(table, rows, options = {}) {
      const params = new URLSearchParams({ database, deduplicate_insert: options.dedupToken ? "enable" : "disable" });
      if (options.dedupToken) params.set("insert_deduplication_token", options.dedupToken);
      const body = JSON.stringify(rows);
      const [json, ms] = await timed(async () => {
        const response = await fetch(`${apiUrl}/v1/tables/${table}?${params}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ingestKey}`, "Content-Type": "application/json" },
          body,
        });
        return (await ensureOk(response, `insert ${table}`)).json() as Promise<{ inserted?: number }>;
      });
      // A deduplicated retry may legitimately report fewer rows; only first sends must match.
      if (!options.dedupToken && json.inserted !== rows.length) {
        throw new Error(`RawTree acknowledged ${json.inserted} of ${rows.length} rows`);
      }
      return { ms, bytes: Buffer.byteLength(body) };
    },
    async query<T>(sql: string) {
      const [json, ms] = await timed(async () => {
        const response = await fetch(`${apiUrl}/v1/query?database=${encodeURIComponent(database)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${queryKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql }),
        });
        return (await ensureOk(response, "query")).json() as Promise<{ data: T[]; statistics?: unknown }>;
      });
      return { rows: json.data, ms, statistics: json.statistics };
    },
  };
}
