// Test console server: serves the Vite build (dist/) and three JSON APIs.
//   GET  /api/config        public settings for the UI (never secrets)
//   POST /api/server-event  { name, properties, eventId? } -> createServerAnalytics
//   POST /api/stored        { eventIds, recordingIds } -> stored row counts from RawTree (read-only key)
//
// Env: PORT (3001), COLLECTOR_URL (http://localhost:3000/api/collect), ANALYTICS_SERVER_TOKEN,
//      RAWTREE_API_URL (https://api.rawtree.com), RAWTREE_DATABASE, RAWTREE_QUERY_KEY,
//      RAWTREE_TABLE_PREFIX, CONSOLE_ENV_FILE (default ../../.env.local; "none" disables it).
// Variables already set in the environment win over the env file.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createServerAnalytics, type Properties } from "@rawtree/analytics/server";

const envFile = process.env.CONSOLE_ENV_FILE ?? join(import.meta.dirname, "../../.env.local");
if (envFile !== "none" && existsSync(envFile)) {
  process.loadEnvFile(envFile); // does not override variables that are already set
  console.log(`Loaded env file ${resolve(envFile)}`);
}

const env = process.env;
const PORT = Number(env.PORT ?? 3001);
const COLLECTOR_URL = env.COLLECTOR_URL ?? "http://localhost:3000/api/collect";
const SERVER_TOKEN = env.ANALYTICS_SERVER_TOKEN ?? "";
const RAWTREE_API_URL = (env.RAWTREE_API_URL ?? "https://api.rawtree.com").replace(/\/$/, "");
const DATABASE = env.RAWTREE_DATABASE ?? "";
const QUERY_KEY = env.RAWTREE_QUERY_KEY ?? "";
const TABLE_PREFIX = /^[A-Za-z0-9_]*$/.test(env.RAWTREE_TABLE_PREFIX ?? "") ? (env.RAWTREE_TABLE_PREFIX ?? "") : "";
const DIST = join(import.meta.dirname, "dist");
const ID = /^[A-Za-z0-9_:.\-]{1,128}$/;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 100_000) throw new Error("body too large");
  }
  const value = JSON.parse(text || "{}") as unknown;
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// ---------- server events ----------

/** Stable, outcome-derived IDs like the recipes use (signup:<accountId>, login:<loginId>, ...). */
const ID_PREFIX: Record<string, [string, string]> = {
  signup_completed: ["signup", "acct"],
  login_succeeded: ["login", "login"],
  export_completed: ["export", "exp"],
};

async function serverEvent(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  if (!SERVER_TOKEN) return { status: 503, body: { ok: false, error: "ANALYTICS_SERVER_TOKEN is not set" } };
  const name = typeof body.name === "string" ? body.name : "";
  const properties = body.properties;
  if (!name || name.length > 128) return { status: 400, body: { ok: false, error: "name is required" } };
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return { status: 400, body: { ok: false, error: "properties must be an object" } };
  }
  const [prefix, kind] = ID_PREFIX[name] ?? [name.replace(/[^A-Za-z0-9_]/g, "_"), "evt"];
  const outcomeId = `${kind}_${randomBytes(9).toString("hex")}`;
  const eventId = String(body.eventId ?? `${prefix}:${outcomeId}`); // the SDK validates it
  const userId = kind === "acct" ? eventId.slice(prefix.length + 1) : undefined;

  // Capture the request as sent and the collector's last answer to show them in the UI.
  let request: unknown;
  let status: number | undefined;
  const analytics = createServerAnalytics({
    endpoint: COLLECTOR_URL,
    token: SERVER_TOKEN,
    fetch: async (input, init) => {
      if (typeof init?.body === "string") request = JSON.parse(init.body);
      const response = await fetch(input, init);
      status = response.status;
      return response;
    },
  });
  try {
    await analytics.sendEvent(name, properties as Properties, { eventId, userId });
    return { status: 200, body: { eventId, ok: true, status, request } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`server event ${name} (${eventId}) failed: ${message}`);
    return { status: 200, body: { eventId, ok: false, status, error: message, request } };
  }
}

// ---------- stored rows ----------

async function query(sql: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${RAWTREE_API_URL}/v1/query?database=${encodeURIComponent(DATABASE)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${QUERY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!response.ok) throw new Error(`RawTree query failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return ((await response.json()) as { data?: Record<string, unknown>[] }).data ?? [];
}

const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && ID.test(id)).slice(0, 500) : []);
const inList = (list: string[]) => list.map((id) => `'${id}'`).join(", "); // safe: IDs match ID

async function stored(body: Record<string, unknown>): Promise<unknown> {
  if (!QUERY_KEY || !DATABASE) return { configured: false };
  const eventIds = ids(body.eventIds);
  const recordingIds = ids(body.recordingIds);
  // Bound the event scan: the console polls events for 30 s after sending them. Recordings stay
  // unbounded because one recording's parts can span longer than any window.
  const recent = `AND CAST(received_at_ms AS Int64) > ${Date.now() - 10 * 60_000}`;
  const [eventRows, recordingRows] = await Promise.all([
    eventIds.length === 0
      ? []
      : query(`SELECT toString(event_id) AS id, count() AS n FROM ${TABLE_PREFIX}events WHERE toString(event_id) IN (${inList(eventIds)}) ${recent} GROUP BY id`),
    recordingIds.length === 0
      ? []
      : query(
          `SELECT toString(recording_id) AS id, count() AS parts, uniqExact(CAST(chunk_seq AS UInt32), CAST(part_index AS UInt32)) AS unique_parts FROM ${TABLE_PREFIX}recordings WHERE toString(recording_id) IN (${inList(recordingIds)}) GROUP BY id`,
        ),
  ]);
  return {
    events: Object.fromEntries(eventRows.map((row) => [String(row.id), Number(row.n)])),
    recordings: Object.fromEntries(recordingRows.map((row) => [String(row.id), { parts: Number(row.parts), uniqueParts: Number(row.unique_parts) }])),
  };
}

// ---------- routing ----------

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method === "GET" && path === "/api/config") {
    return send(res, 200, { collectorUrl: COLLECTOR_URL, database: DATABASE, serverEvents: SERVER_TOKEN !== "", storageCheck: QUERY_KEY !== "" && DATABASE !== "" });
  }
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  if (path === "/api/server-event") {
    const result = await serverEvent(await readJson(req));
    return send(res, result.status, result.body);
  }
  if (path === "/api/stored") {
    try {
      return send(res, 200, await stored(await readJson(req)));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return send(res, 502, { error: "query_failed" });
    }
  }
  return send(res, 404, { error: "not_found" });
}

async function serveStatic(res: ServerResponse, path: string): Promise<void> {
  const file = normalize(join(DIST, path));
  const isAsset = file.startsWith(join(DIST, "assets")) && extname(file) !== "";
  try {
    const content = await readFile(isAsset ? file : join(DIST, "index.html"));
    // Hashed assets can be cached; index.html must not, so a rebuild is picked up on reload.
    res.writeHead(200, {
      "Content-Type": MIME[isAsset ? extname(file) : ".html"] ?? "application/octet-stream",
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(content);
  } catch {
    if (isAsset) res.writeHead(404).end();
    else res.writeHead(500, { "Content-Type": "text/plain" }).end("Build the console first: npm run build");
  }
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const handler = path.startsWith("/api/") ? handleApi(req, res, path) : serveStatic(res, path);
  handler.catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: "internal_error" });
  });
});

server.listen(PORT, () => {
  console.log(`Test console listening on http://localhost:${PORT}`);
  console.log(`  collector ${COLLECTOR_URL} · server events ${SERVER_TOKEN ? "on" : "off (no ANALYTICS_SERVER_TOKEN)"} · storage check ${QUERY_KEY && DATABASE ? `on (${DATABASE})` : "off (no RAWTREE_QUERY_KEY/RAWTREE_DATABASE)"}`);
});
