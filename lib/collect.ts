// Collection endpoint logic: authenticate the producer (allowed browser origin or server
// token), bound the request size, validate with the SDK protocol, and acknowledge only
// after RawTree has accepted every row. The collector is separate from dashboard access
// and must stay reachable by instrumented products.

import { createHash, timingSafeEqual } from "node:crypto";
import { LIMITS, parseCollectRequest, toRows } from "@rawtree/analytics/protocol";
import { insertRows, loadRawTreeConfig, type RawTreeConfig } from "./rawtree.ts";

export type CollectorConfig = {
  rawtree: RawTreeConfig;
  /** Exact origins (scheme://host[:port]) allowed to send browser data, or "*". */
  allowedOrigins: readonly string[] | "*";
  /** When set, requests with `Authorization: Bearer <token>` are trusted server events. */
  serverToken?: string;
};

export function loadCollectorConfig(env: Record<string, string | undefined> = process.env): CollectorConfig {
  const rawtree = loadRawTreeConfig("RAWTREE_INGEST_KEY", env);
  if (!env.ANALYTICS_ALLOWED_ORIGINS) throw new Error("Missing configuration: ANALYTICS_ALLOWED_ORIGINS");
  const origins = env.ANALYTICS_ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
  return {
    rawtree,
    allowedOrigins: origins.includes("*") ? "*" : origins,
    serverToken: env.ANALYTICS_SERVER_TOKEN || undefined,
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function corsHeaders(origin: string | null, config: CollectorConfig): Record<string, string> | undefined {
  if (!origin) return undefined;
  if (config.allowedOrigins !== "*" && !config.allowedOrigins.includes(origin)) return undefined;
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function tokenMatches(header: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${expected}`));
}

async function readBody(request: Request, maxBytes: number): Promise<string | undefined> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function handleCollectOptions(request: Request, config: CollectorConfig = loadCollectorConfig()): Response {
  const cors = corsHeaders(request.headers.get("origin"), config);
  if (!cors) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function handleCollect(
  request: Request,
  config?: CollectorConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Response> {
  let resolved: CollectorConfig;
  try {
    resolved = config ?? loadCollectorConfig();
  } catch (error) {
    console.error(error);
    return json(500, { error: "collector_not_configured", message: "The collector is missing configuration." });
  }

  const origin = request.headers.get("origin");
  const authorization = request.headers.get("authorization");
  const cors = corsHeaders(origin, resolved) ?? {};
  let source: "browser" | "server";
  if (authorization) {
    if (!resolved.serverToken || !tokenMatches(authorization, resolved.serverToken)) {
      return json(401, { error: "invalid_token", message: "Invalid server token." }, cors);
    }
    source = "server";
  } else if (origin && corsHeaders(origin, resolved)) {
    source = "browser";
  } else {
    return json(403, { error: "origin_not_allowed", message: "Origin is not allowed to send analytics." });
  }

  let text: string | undefined;
  try {
    text = await readBody(request, LIMITS.maxRequestBytes);
  } catch {
    return json(400, { error: "invalid_body", message: "Body must be UTF-8 JSON." }, cors);
  }
  if (text === undefined) {
    return json(413, { error: "payload_too_large", message: `Body exceeds ${LIMITS.maxRequestBytes} bytes.` }, cors);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "invalid_json", message: "Body must be JSON." }, cors);
  }

  const receivedAt = now();
  const parsed = parseCollectRequest(body, receivedAt);
  if (!parsed.ok) return json(400, { error: "invalid_request", message: parsed.error }, cors);

  const rows = toRows(parsed.request, {
    receivedAt,
    source,
    // The request's User-Agent header fills in when an event carries none. A
    // producer-supplied user_agent wins so test clients can simulate crawlers.
    userAgent: request.headers.get("user-agent")?.slice(0, LIMITS.maxUserAgentLength) || undefined,
  });
  try {
    await Promise.all([
      insertRows(resolved.rawtree, "events", rows.events, fetchImpl),
      insertRows(resolved.rawtree, "recordings", rows.recordings, fetchImpl),
    ]);
  } catch (error) {
    // Retryable for the producer: rows keep their IDs, and readers deduplicate.
    console.error("analytics collector insert failed", error);
    return json(503, { error: "storage_unavailable", message: "Analytics storage is unavailable; retry later." }, cors);
  }
  return json(200, { accepted: { events: parsed.eventCount, recording_parts: parsed.partCount } }, cors);
}
