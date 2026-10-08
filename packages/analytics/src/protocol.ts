// Wire contract between the SDK and the collector, and the rows the collector stores in
// RawTree. Types and the validator in this file are the contract's source of truth.
//
// Units: all timestamps are integer milliseconds since the Unix epoch (UTC). Sizes are
// UTF-8 bytes. Event properties are product-defined JSON kept apart from reserved fields.

export const PROTOCOL_VERSION = 1;

export const LIMITS = {
  /** Largest request body the collector accepts. */
  maxRequestBytes: 1_000_000,
  /** Largest request body for page-exit flushes (keepalive in-flight limit is 64 KiB). */
  maxKeepaliveRequestBytes: 60_000,
  maxEventsPerRequest: 500,
  maxRecordingPartsPerRequest: 100,
  maxEventNameLength: 128,
  maxIdLength: 128,
  maxUrlLength: 2048,
  maxPropertiesBytes: 16_384,
  maxPropertiesDepth: 6,
  /** Largest user_agent string accepted per event. */
  maxUserAgentLength: 512,
  /** Largest payload slice in one recording part (before JSON string escaping). */
  maxPartPayloadBytes: 256 * 1024,
} as const;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Properties = { [key: string]: JsonValue };

/** One product event as sent by an SDK. */
export type EventInput = {
  /** Stable across retries. Readers deduplicate on it. */
  event_id: string;
  name: string;
  occurred_at: number;
  session_id?: string;
  anonymous_id?: string;
  /** Opaque, producer-supplied. Untrusted unless the request is server-authenticated. */
  user_id?: string;
  /** Sanitized URL (no credentials or hash; only allowlisted query parameters). */
  page_url?: string;
  referrer?: string;
  /** Producer-supplied user agent. The collector falls back to the request's User-Agent header. */
  user_agent?: string;
  properties?: Properties;
};

/** One part of an rrweb recording chunk. See the recording format notes in README. */
export type RecordingPartInput = {
  recording_id: string;
  session_id: string;
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
  chunk_bytes: number;
  /** Slice of the chunk's rrweb event array serialized as JSON. */
  payload: string;
};

export type CollectRequest = {
  v: typeof PROTOCOL_VERSION;
  /** Client clock when the request was built, to estimate clock skew. */
  sent_at: number;
  sdk?: string;
  events?: EventInput[];
  recording_parts?: RecordingPartInput[];
};

export type EventSource = "browser" | "server";

/** Row stored in the RawTree `events` table. */
export type EventRow = {
  v: typeof PROTOCOL_VERSION;
  event_id: string;
  event_name: string;
  occurred_at_ms: number;
  client_sent_at_ms: number;
  received_at_ms: number;
  source: EventSource;
  sdk?: string;
  session_id?: string;
  anonymous_id?: string;
  user_id?: string;
  page_url?: string;
  page_path?: string;
  referrer?: string;
  user_agent?: string;
  properties: Properties;
};

/** Row stored in the RawTree `recordings` table: one row per recording part. */
export type RecordingRow = RecordingPartInput & {
  format_version: 1;
  chunk_id: string;
  payload_encoding: "json";
  payload_bytes: number;
  received_at_ms: number;
  source: EventSource;
};

export type ValidationResult =
  | { ok: true; request: CollectRequest; eventCount: number; partCount: number }
  | { ok: false; error: string };

const ID = /^[A-Za-z0-9_:.\-]+$/;
const EVENT_NAME = /^[A-Za-z0-9_.:\-/ ]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const MIN_TIMESTAMP = Date.UTC(2000, 0, 1);
const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message);
}

function id(value: unknown, field: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > LIMITS.maxIdLength || !ID.test(value)) {
    fail(`${field} must be 1-${LIMITS.maxIdLength} characters of [A-Za-z0-9_:.-]`);
  }
  return value;
}

function timestamp(value: unknown, field: string, now: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_TIMESTAMP || value > now + 86_400_000) {
    fail(`${field} must be an integer epoch-millisecond timestamp`);
  }
  return value;
}

function count(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) fail(`${field} must be an integer >= ${min}`);
  return value;
}

function url(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > LIMITS.maxUrlLength || !/^https?:\/\//.test(value)) {
    fail(`${field} must be an http(s) URL up to ${LIMITS.maxUrlLength} characters`);
  }
  return value;
}

/** Trimmed, control-character-free user agent up to LIMITS.maxUserAgentLength. */
function userAgent(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(`${field} must be a string`);
  const cleaned = value.replace(CONTROL_CHARS, " ").trim();
  if (cleaned.length === 0 || cleaned.length > LIMITS.maxUserAgentLength) {
    fail(`${field} must be 1-${LIMITS.maxUserAgentLength} characters`);
  }
  return cleaned;
}

/**
 * RawTree does not store null values or empty objects inside JSON rows, so they are
 * removed here to make stored properties equal to what the collector accepted.
 */
export function normalizeProperties(value: unknown, depth = 0): Properties {
  if (!isRecord(value)) fail("properties must be a JSON object");
  if (depth > LIMITS.maxPropertiesDepth) fail(`properties nest deeper than ${LIMITS.maxPropertiesDepth} levels`);
  const result: Properties = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.length === 0 || key.length > 128) fail("property names must be 1-128 characters");
    const normalized = normalizeValue(item, depth + 1);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function normalizeValue(value: unknown, depth: number): JsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("property numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) {
    if (depth > LIMITS.maxPropertiesDepth) fail(`properties nest deeper than ${LIMITS.maxPropertiesDepth} levels`);
    return value.map((item) => normalizeValue(item, depth + 1) ?? null).filter((item) => item !== null);
  }
  if (isRecord(value)) {
    const nested = normalizeProperties(value, depth);
    return Object.keys(nested).length > 0 ? nested : undefined;
  }
  fail("properties must contain only JSON values");
}

function parseEvent(value: unknown, index: number, now: number): EventInput {
  if (!isRecord(value)) fail(`events[${index}] must be an object`);
  const name = value.name;
  if (typeof name !== "string" || name.length === 0 || name.length > LIMITS.maxEventNameLength || !EVENT_NAME.test(name)) {
    fail(`events[${index}].name must be 1-${LIMITS.maxEventNameLength} characters of [A-Za-z0-9_.:-/ ]`);
  }
  const properties = value.properties === undefined ? {} : normalizeProperties(value.properties);
  if (utf8Length(JSON.stringify(properties)) > LIMITS.maxPropertiesBytes) {
    fail(`events[${index}].properties exceed ${LIMITS.maxPropertiesBytes} bytes`);
  }
  const event: EventInput = {
    event_id: id(value.event_id, `events[${index}].event_id`) as string,
    name,
    occurred_at: timestamp(value.occurred_at, `events[${index}].occurred_at`, now),
    properties,
  };
  const optional = {
    session_id: id(value.session_id, `events[${index}].session_id`, true),
    anonymous_id: id(value.anonymous_id, `events[${index}].anonymous_id`, true),
    user_id: id(value.user_id, `events[${index}].user_id`, true),
    page_url: url(value.page_url, `events[${index}].page_url`),
    referrer: url(value.referrer, `events[${index}].referrer`),
    user_agent: userAgent(value.user_agent, `events[${index}].user_agent`),
  };
  for (const [key, item] of Object.entries(optional)) if (item !== undefined) Object.assign(event, { [key]: item });
  return event;
}

function parsePart(value: unknown, index: number, now: number): RecordingPartInput {
  if (!isRecord(value)) fail(`recording_parts[${index}] must be an object`);
  const f = `recording_parts[${index}]`;
  const part: RecordingPartInput = {
    recording_id: id(value.recording_id, `${f}.recording_id`) as string,
    session_id: id(value.session_id, `${f}.session_id`) as string,
    chunk_seq: count(value.chunk_seq, `${f}.chunk_seq`),
    part_index: count(value.part_index, `${f}.part_index`),
    part_count: count(value.part_count, `${f}.part_count`, 1),
    event_seq_start: count(value.event_seq_start, `${f}.event_seq_start`),
    event_seq_end: count(value.event_seq_end, `${f}.event_seq_end`),
    event_count: count(value.event_count, `${f}.event_count`, 1),
    first_timestamp: timestamp(value.first_timestamp, `${f}.first_timestamp`, now),
    last_timestamp: timestamp(value.last_timestamp, `${f}.last_timestamp`, now),
    has_meta: value.has_meta === true,
    has_full_snapshot: value.has_full_snapshot === true,
    chunk_bytes: count(value.chunk_bytes, `${f}.chunk_bytes`, 1),
    payload: typeof value.payload === "string" ? value.payload : fail(`${f}.payload must be a string`),
  };
  if (part.part_index >= part.part_count) fail(`${f}.part_index must be below part_count`);
  if (part.event_seq_end - part.event_seq_start + 1 !== part.event_count) fail(`${f} event sequence range does not match event_count`);
  if (part.last_timestamp < part.first_timestamp) fail(`${f}.last_timestamp precedes first_timestamp`);
  if (utf8Length(part.payload) > LIMITS.maxPartPayloadBytes) fail(`${f}.payload exceeds ${LIMITS.maxPartPayloadBytes} bytes`);
  return part;
}

/** Validate an untrusted request body that has already been JSON-parsed. */
export function parseCollectRequest(body: unknown, now = Date.now()): ValidationResult {
  try {
    if (!isRecord(body)) fail("body must be a JSON object");
    if (body.v !== PROTOCOL_VERSION) fail(`unsupported protocol version; expected v=${PROTOCOL_VERSION}`);
    const events = body.events ?? [];
    const parts = body.recording_parts ?? [];
    if (!Array.isArray(events) || events.length > LIMITS.maxEventsPerRequest) fail(`events must be an array of at most ${LIMITS.maxEventsPerRequest}`);
    if (!Array.isArray(parts) || parts.length > LIMITS.maxRecordingPartsPerRequest) {
      fail(`recording_parts must be an array of at most ${LIMITS.maxRecordingPartsPerRequest}`);
    }
    if (events.length + parts.length === 0) fail("request contains no events or recording parts");
    const sdk = body.sdk === undefined ? undefined : typeof body.sdk === "string" && body.sdk.length <= 64 ? body.sdk : fail("sdk must be a short string");
    const request: CollectRequest = {
      v: PROTOCOL_VERSION,
      sent_at: timestamp(body.sent_at, "sent_at", now),
      events: events.map((event, i) => parseEvent(event, i, now)),
      recording_parts: parts.map((part, i) => parsePart(part, i, now)),
    };
    if (sdk) request.sdk = sdk;
    return { ok: true, request, eventCount: events.length, partCount: parts.length };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}

function pagePath(pageUrl: string | undefined): string | undefined {
  if (!pageUrl) return undefined;
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return undefined;
  }
}

/** Map a validated request to the rows stored in RawTree. */
export function toRows(
  request: CollectRequest,
  context: { receivedAt: number; source: EventSource; /** Fallback when an event carries no user_agent. */ userAgent?: string },
) {
  const events: EventRow[] = (request.events ?? []).map((event) => {
    const row: EventRow = {
      v: PROTOCOL_VERSION,
      event_id: event.event_id,
      event_name: event.name,
      occurred_at_ms: event.occurred_at,
      client_sent_at_ms: request.sent_at,
      received_at_ms: context.receivedAt,
      source: context.source,
      properties: event.properties ?? {},
    };
    const optional = {
      sdk: request.sdk,
      session_id: event.session_id,
      anonymous_id: event.anonymous_id,
      user_id: event.user_id,
      page_url: event.page_url,
      page_path: pagePath(event.page_url),
      referrer: event.referrer,
      user_agent: event.user_agent ?? context.userAgent,
    };
    for (const [key, value] of Object.entries(optional)) if (value !== undefined) Object.assign(row, { [key]: value });
    return row;
  });
  const recordings: RecordingRow[] = (request.recording_parts ?? []).map((part) => ({
    ...part,
    format_version: 1,
    chunk_id: `${part.recording_id}:${part.chunk_seq}:${part.part_index}`,
    payload_encoding: "json",
    payload_bytes: utf8Length(part.payload),
    received_at_ms: context.receivedAt,
    source: context.source,
  }));
  return { events, recordings };
}
