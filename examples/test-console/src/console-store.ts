// Test console state: owns the analytics client lifecycle (driven by consent), wraps fetch
// to observe every collector request, and polls the console server for stored rows.
// React reads it through useConsole() (useSyncExternalStore); no state library needed.

import { type Analytics, type AnalyticsError, createAnalytics, type Properties } from "@rawtree/analytics";
import type { CollectRequest, EventInput, RecordingPartInput } from "@rawtree/analytics/protocol";
import { useSyncExternalStore } from "react";

export type Config = { collectorUrl: string; database: string; serverEvents: boolean; storageCheck: boolean };
export type Consent = { analytics: boolean; recording: boolean };
export type Identity = { anonymousId: string; sessionId: string; recordingId: string };

/** Collector delivery of the latest request that carried the item. */
export type Delivery =
  | { state: "queued" }
  | { state: "sent"; status: number; attempts: number }
  | { state: "failed"; status?: number; error: string; attempts: number };

export type Storage =
  | { state: "waiting" } // not delivered yet
  | { state: "checking"; since: number }
  | { state: "stored" }
  | { state: "missing" }
  | { state: "unconfigured" };

export type EventEntry = {
  kind: "event";
  key: string;
  at: number;
  id: string | undefined; // undefined while a server event request is in flight
  name: string;
  source: "browser" | "server";
  delivery: Delivery;
  storage: Storage;
  storedRows?: number;
  sends: number;
  payload: unknown;
};

export type RecordingEntry = {
  kind: "recording";
  key: string;
  at: number;
  id: string;
  partsSent: number;
  partsStored?: number;
  delivery: Delivery;
  storage: Storage;
  payload: unknown;
};

export type ErrorEntry = { kind: "error"; key: string; at: number; error: AnalyticsError };
export type Entry = EventEntry | RecordingEntry | ErrorEntry;

export type ConsoleState = {
  config?: Config;
  configError?: string;
  consent: Consent;
  identity?: Identity;
  recording: "off" | "loading" | "on";
  lastServerEvent?: { name: string; properties: Properties; eventId: string };
  entries: Entry[]; // newest first
  /** Bytes of rrweb payload accepted by the collector, for the playground privacy checks. */
  recordingBytesSent: number;
};

const CONSENT_KEY = "rawtree_test_console:consent";
const POLL_MS = 1500;
const STORE_TIMEOUT_MS = 30_000;

function loadConsent(): Consent {
  try {
    const value = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null") as Partial<Consent> | null;
    const analytics = value?.analytics === true;
    return { analytics, recording: analytics && value?.recording === true };
  } catch {
    return { analytics: false, recording: false };
  }
}

let state: ConsoleState = { consent: loadConsent(), recording: "off", entries: [], recordingBytesSent: 0 };

// rrweb payloads the collector accepted, kept so the playground can prove what never left the page.
const sentRecordingPayloads: string[] = [];
let sentRecordingBytes = 0;
const MAX_KEPT_RECORDING_BYTES = 20 * 1024 * 1024;

/** For each needle: true when it appears in any recording payload accepted so far. */
export function findInSentRecordings(needles: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(needles.map((needle) => [needle, sentRecordingPayloads.some((payload) => payload.includes(needle))]));
}
const listeners = new Set<() => void>();
let client: Analytics | undefined;
let stopRecorder: (() => void) | undefined;
let counter = 0;
const sentPartKeys = new Map<string, Set<string>>(); // recording_id -> "chunk:part" acknowledged by the collector

function setState(patch: Partial<ConsoleState>): void {
  const identity = client
    ? { anonymousId: client.anonymousId, sessionId: client.sessionId, recordingId: client.recordingId }
    : undefined;
  state = { ...state, identity, ...patch };
  for (const listener of listeners) listener();
}

function updateEntries(update: (entries: Entry[]) => Entry[]): void {
  setState({ entries: update(state.entries) });
}

function patchEntry(match: (entry: Entry) => boolean, patch: (entry: Entry) => Entry): boolean {
  let found = false;
  updateEntries((entries) =>
    entries.map((entry) => {
      if (!match(entry)) return entry;
      found = true;
      return patch(entry);
    }),
  );
  return found;
}

const nextKey = () => `k${++counter}`;
const isEvent = (id: string) => (entry: Entry) => entry.kind === "event" && entry.id === id;
const isRecording = (id: string) => (entry: Entry) => entry.kind === "recording" && entry.id === id;
const attempts = (delivery: Delivery) => (delivery.state === "queued" ? 0 : delivery.attempts);

function addEntry(entry: Entry): void {
  updateEntries((entries) => [entry, ...entries].slice(0, 500));
}

function deliveredStorage(): Storage {
  return state.config?.storageCheck ? { state: "checking", since: Date.now() } : { state: "unconfigured" };
}

// ---------- collector requests ----------

function recordOutcome(events: EventInput[], parts: RecordingPartInput[], status: number | undefined, error: string | undefined): void {
  const ok = status !== undefined && status >= 200 && status < 300;
  const deliveryFor = (previous: Delivery): Delivery =>
    ok
      ? { state: "sent", status, attempts: attempts(previous) + 1 }
      : { state: "failed", status, error: error ?? "request failed", attempts: attempts(previous) + 1 };

  for (const event of events) {
    const patch = (entry: Entry): Entry =>
      entry.kind === "event"
        ? { ...entry, payload: event, delivery: deliveryFor(entry.delivery), storage: ok ? deliveredStorage() : entry.storage }
        : entry;
    if (!patchEntry(isEvent(event.event_id), patch)) {
      // Not created by a console button (should not happen, but show it anyway).
      const entry: EventEntry = { kind: "event", key: nextKey(), at: Date.now(), id: event.event_id, name: event.name, source: "browser", delivery: { state: "queued" }, storage: { state: "waiting" }, sends: 1, payload: event };
      addEntry(patch(entry));
    }
  }

  const byRecording = Map.groupBy(parts, (part) => part.recording_id);
  for (const [recordingId, recordingParts] of byRecording) {
    const keys = sentPartKeys.get(recordingId) ?? new Set<string>();
    sentPartKeys.set(recordingId, keys);
    if (ok) {
      for (const part of recordingParts) {
        keys.add(`${part.chunk_seq}:${part.part_index}`);
        if (sentRecordingBytes < MAX_KEPT_RECORDING_BYTES) {
          sentRecordingPayloads.push(part.payload);
          sentRecordingBytes += part.payload.length;
        }
      }
      setState({ recordingBytesSent: sentRecordingBytes });
    }
    // Show metadata for the parts of this request; the rrweb payload itself is shortened.
    const payload = recordingParts.map((part) => ({ ...part, payload: `${part.payload.slice(0, 120)}… (${part.payload.length} chars)` }));
    const patch = (entry: Entry): Entry =>
      entry.kind === "recording"
        ? { ...entry, payload, partsSent: keys.size, delivery: deliveryFor(entry.delivery), storage: ok ? deliveredStorage() : entry.storage }
        : entry;
    if (!patchEntry(isRecording(recordingId), patch)) {
      addEntry(patch({ kind: "recording", key: nextKey(), at: Date.now(), id: recordingId, partsSent: 0, delivery: { state: "queued" }, storage: { state: "waiting" }, payload }));
    }
  }
  if (ok) void pollStorage();
}

/** fetch for the SDK: same behavior, but every request's outcome is recorded per event ID / recording. */
const instrumentedFetch: typeof fetch = async (input, init) => {
  let body: Partial<CollectRequest> = {};
  try {
    if (typeof init?.body === "string") body = JSON.parse(init.body) as Partial<CollectRequest>;
  } catch {
    // Not JSON: nothing to track.
  }
  const events = body.events ?? [];
  const parts = body.recording_parts ?? [];
  try {
    const response = await globalThis.fetch(input, init);
    let error: string | undefined;
    if (!response.ok) {
      const detail = (await response.clone().json().catch(() => ({}))) as { error?: unknown; message?: unknown };
      error = typeof detail.error === "string" ? detail.error : response.statusText || "error";
    }
    recordOutcome(events, parts, response.status, error);
    return response;
  } catch (error) {
    recordOutcome(events, parts, undefined, error instanceof Error ? `network error: ${error.message}` : "network error");
    throw error;
  }
};

function onSdkError(error: AnalyticsError): void {
  addEntry({ kind: "error", key: nextKey(), at: Date.now(), error });
}

// ---------- consent and lifecycle ----------

async function applyConsent(): Promise<void> {
  const { config, consent } = state;
  if (!config) return;
  if (consent.analytics && !client) {
    client = createAnalytics({ endpoint: config.collectorUrl, fetch: instrumentedFetch, onError: onSdkError, flushIntervalMs: 2000 });
  }
  if (stopRecorder && !(consent.analytics && consent.recording)) {
    stopRecorder();
    stopRecorder = undefined;
    // Recording withdrawn, analytics kept: drop unsent recording data. When analytics is
    // withdrawn too, stop() below discards everything.
    if (consent.analytics) client?.discardRecording();
  }
  if (!consent.analytics && client) {
    client.stop();
    client = undefined;
  }
  if (consent.analytics && consent.recording && !stopRecorder && state.recording !== "loading") {
    setState({ recording: "loading" });
    try {
      const { startRecording } = await import("@rawtree/analytics/recorder");
      // Consent may have changed while the chunk loaded.
      if (client && state.consent.analytics && state.consent.recording && !stopRecorder) stopRecorder = startRecording(client);
    } catch (error) {
      console.error("could not load the recorder", error);
    }
  }
  setState({ recording: stopRecorder ? "on" : "off" });
}

export function setConsent(next: Consent): void {
  const consent = { analytics: next.analytics, recording: next.analytics && next.recording };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  setState({ consent });
  void applyConsent();
}

export async function init(): Promise<void> {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setState({ config: (await response.json()) as Config });
    await applyConsent();
  } catch (error) {
    setState({ configError: error instanceof Error ? error.message : String(error) });
  }
}

export async function flush(): Promise<void> {
  await client?.flush();
  setState({});
}

export function resetIdentity(): void {
  client?.reset();
  setState({});
}

// ---------- sending ----------

/** Queue a browser event. Returns the event ID, or undefined when there is no consent or the SDK rejected it. */
export function sendBrowserEvent(name: string, properties: Properties): string | undefined {
  const id = client?.sendEvent(name, properties);
  if (id) {
    addEntry({ kind: "event", key: nextKey(), at: Date.now(), id, name, source: "browser", delivery: { state: "queued" }, storage: { state: "waiting" }, sends: 1, payload: { name, properties } });
  }
  return id;
}

type ServerEventResponse = { eventId?: string; ok?: boolean; status?: number; error?: string; request?: unknown };

export async function sendServerEvent(name: string, properties: Properties, eventId?: string): Promise<void> {
  const existing = eventId ? state.entries.find(isEvent(eventId)) : undefined;
  const key = existing?.key ?? nextKey();
  if (existing?.kind === "event") {
    patchEntry((entry) => entry.key === key, (entry) => (entry.kind === "event" ? { ...entry, sends: entry.sends + 1, storage: { state: "waiting" } } : entry));
  } else {
    addEntry({ kind: "event", key, at: Date.now(), id: eventId, name, source: "server", delivery: { state: "queued" }, storage: { state: "waiting" }, sends: 1, payload: { name, properties } });
  }
  let result: ServerEventResponse;
  try {
    const response = await fetch("/api/server-event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, properties, eventId }) });
    result = (await response.json()) as ServerEventResponse;
    if (!response.ok && !result.error) result.error = `console server answered ${response.status}`;
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const id = result.eventId ?? eventId;
  if (id) setState({ lastServerEvent: { name, properties, eventId: id } });
  patchEntry(
    (entry) => entry.key === key,
    (entry) => {
      if (entry.kind !== "event") return entry;
      const tries = attempts(entry.delivery) + 1;
      const delivery: Delivery = result.ok
        ? { state: "sent", status: result.status ?? 200, attempts: tries }
        : { state: "failed", status: result.status, error: result.error ?? "failed", attempts: tries };
      return { ...entry, id, delivery, payload: result.request ?? entry.payload, storage: result.ok ? deliveredStorage() : entry.storage };
    },
  );
  if (result.ok) void pollStorage();
}

// ---------- storage polling ----------

type StoredResponse = { configured?: false; events?: Record<string, number>; recordings?: Record<string, { parts: number; uniqueParts: number }> };
let polling = false;

async function pollStorage(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const now = Date.now();
      // Expire what has been checking for too long.
      updateEntries((entries) =>
        entries.map((entry) =>
          entry.kind !== "error" && entry.storage.state === "checking" && now - entry.storage.since > STORE_TIMEOUT_MS
            ? { ...entry, storage: { state: "missing" } }
            : entry,
        ),
      );
      const checking = state.entries.filter((entry) => entry.kind !== "error" && entry.storage.state === "checking");
      const eventIds = checking.flatMap((entry) => (entry.kind === "event" && entry.id ? [entry.id] : []));
      const recordingIds = checking.flatMap((entry) => (entry.kind === "recording" ? [entry.id] : []));
      if (eventIds.length === 0 && recordingIds.length === 0) return;

      let stored: StoredResponse;
      try {
        const response = await fetch("/api/stored", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventIds, recordingIds }) });
        if (!response.ok) continue;
        stored = (await response.json()) as StoredResponse;
      } catch {
        continue;
      }
      updateEntries((entries) =>
        entries.map((entry) => {
          if (entry.kind === "error" || entry.storage.state !== "checking") return entry;
          if (stored.configured === false) return { ...entry, storage: { state: "unconfigured" } };
          if (entry.kind === "event") {
            const rows = entry.id ? (stored.events?.[entry.id] ?? 0) : 0;
            return rows > 0 ? { ...entry, storedRows: rows, storage: { state: "stored" } } : entry;
          }
          const parts = stored.recordings?.[entry.id]?.uniqueParts ?? 0;
          return { ...entry, partsStored: parts, storage: parts >= entry.partsSent ? { state: "stored" } : entry.storage };
        }),
      );
    }
  } finally {
    polling = false;
  }
}

// ---------- React binding ----------

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConsole(): ConsoleState {
  return useSyncExternalStore(subscribe, () => state);
}
