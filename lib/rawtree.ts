// Server-only RawTree HTTP client: configuration, reads, and acknowledged inserts.
// Credentials and destinations come from configuration or the visitor's sign-in (lib/access.ts),
// never from request bodies.

import { createHash } from "node:crypto";

export type RawTreeConfig = {
  apiUrl: string;
  database: string;
  /** A RawTree API key: the env ingest or query key, or the visitor's own key. Empty with `connect`. */
  key: string;
  /** Prefix for table names, e.g. "e2e_" for disposable test tables. Empty in production. */
  tablePrefix: string;
  /** Vercel Connect sign-in: a short-lived token and the picked organization and cluster. */
  connect?: {
    organization: string;
    cluster: string;
    /** Resolves the visitor's token; throws a 401 RawTreeError when they must connect again. */
    token: () => Promise<string>;
    /** Called when RawTree rejects the token, to drop it from the cache. */
    onUnauthorized: () => void;
  };
};

/** RawTree API base URL from the environment (all modes). */
export const rawTreeApiUrl = (env: Record<string, string | undefined> = process.env) => (env.RAWTREE_API_URL || "https://api.rawtree.com").replace(/\/$/, "");

/** RawTree settings from the environment, with the ingest or the query key. */
export function loadRawTreeConfig(
  keyName: "RAWTREE_INGEST_KEY" | "RAWTREE_QUERY_KEY",
  env: Record<string, string | undefined> = process.env,
): RawTreeConfig {
  const missing = ["RAWTREE_DATABASE", keyName].filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing configuration: ${missing.join(", ")}`);
  return {
    apiUrl: rawTreeApiUrl(env),
    database: env.RAWTREE_DATABASE ?? "",
    key: env[keyName] ?? "",
    tablePrefix: env.RAWTREE_TABLE_PREFIX ?? "",
  };
}

/** The deployment's name for a table (prefix-aware). */
export function tableName(config: RawTreeConfig, table: "events" | "recordings"): string {
  return `${config.tablePrefix}${table}`;
}

export class RawTreeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** RawTree creates a table with its first insert, so a missing table means no data yet. */
export const isMissingTable = (error: unknown) => error instanceof RawTreeError && /table \S+ not found/i.test(error.message);

export type Row = Record<string, string | number | boolean>;

/** One authenticated RawTree call. Connect calls log one outcome line (no token, SQL, or body). */
async function send(config: RawTreeConfig, path: string, params: URLSearchParams, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  const { connect } = config;
  // Env mode builds its config without failing, so a missing database surfaces here, in the page's error card.
  if (!config.database) throw new RawTreeError("Missing configuration: RAWTREE_DATABASE. Set it to the database that holds the events and recordings tables.", 500);
  if (connect) {
    params.set("organization", connect.organization);
    params.set("cluster", connect.cluster);
    params.set("database", config.database);
  }
  const key = connect ? await connect.token() : config.key;
  const started = Date.now();
  const response = await fetchImpl(`${config.apiUrl}${path}${params.size ? `?${params}` : ""}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  if (connect) {
    const outcome = `RawTree ${init.method} ${path} (${connect.organization}/${connect.cluster}/${config.database}) -> ${response.status} in ${Date.now() - started} ms`;
    if (response.ok) console.info(outcome);
    else console.warn(outcome);
    if (response.status === 401) connect.onUnauthorized();
  }
  return response;
}

/**
 * Run one read statement and return its rows. Values are coerced by the result's column
 * types (numbers, booleans, everything else a string), so string IDs that look numeric
 * stay strings. Cast Dynamic columns in SQL to get a number or boolean back.
 */
export async function runQuery<T = Row>(config: RawTreeConfig, sql: string, fetchImpl: typeof fetch = fetch): Promise<T[]> {
  const response = await send(config, "/v1/query", new URLSearchParams(), {
    method: "POST",
    body: JSON.stringify({ sql, database: config.database }),
    signal: AbortSignal.timeout(30_000),
  }, fetchImpl);
  const text = await response.text();
  if (!response.ok) throw new RawTreeError(`RawTree query failed: ${text.slice(0, 300)}`, response.status);
  const { meta = [], data = [] } = JSON.parse(text) as { meta?: { name: string; type: string }[]; data?: Record<string, unknown>[] };
  const kind = new Map(meta.map(({ name, type }) => [name, /^(Nullable\()?(U?Int|Float|Decimal)/.test(type) ? "number" : /^(Nullable\()?Bool/.test(type) ? "boolean" : "string"]));
  const coerce = (name: string, value: unknown) =>
    kind.get(name) === "number" ? Number(value) || 0 : kind.get(name) === "boolean" ? value === true || value === 1 || value === "true" || value === "1" : String(value ?? "");
  return data.map((row) => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, coerce(name, value)])) as T);
}

/**
 * Insert rows into one table and resolve only after RawTree acknowledges every row.
 * The deduplication token makes an identical retry a no-op within RawTree's dedup window;
 * readers still deduplicate by ID because that window is bounded (about one hour).
 */
export async function insertRows(
  config: RawTreeConfig,
  table: "events" | "recordings",
  rows: { event_id?: string; chunk_id?: string }[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (rows.length === 0) return;
  const token = createHash("sha256")
    .update(`${table}\n${rows.map((row) => row.event_id ?? row.chunk_id).join("\n")}`)
    .digest("hex");
  const params = new URLSearchParams({ database: config.database, deduplicate_insert: "enable", insert_deduplication_token: token });
  const response = await send(config, `/v1/tables/${tableName(config, table)}`, params, {
    method: "POST",
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(20_000),
  }, fetchImpl);
  const text = await response.text();
  if (!response.ok) throw new RawTreeError(`RawTree insert into ${table} failed: ${text.slice(0, 300)}`, response.status);
  // A deduplicated retry may report fewer rows than sent; anything else must match.
  const inserted = (JSON.parse(text) as { inserted?: unknown }).inserted;
  if (typeof inserted !== "number" || inserted > rows.length) {
    throw new RawTreeError(`RawTree acknowledged ${String(inserted)} of ${rows.length} rows in ${table}`, 502);
  }
}
