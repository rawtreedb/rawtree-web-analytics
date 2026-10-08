// Browser (and SSR-safe) analytics client.
//
// Identity and session rules:
// - anonymous_id: random, persisted in localStorage, shared by tabs of the same origin,
//   kept across reloads and navigation. Rotated by reset() and removed by stop().
// - session_id: persisted in localStorage with the time of the last activity. Shared by
//   tabs; a new session starts after sessionTimeoutMs without events or recording
//   activity (default 30 minutes). Rotated by reset() and removed by stop().
// - user_id: optional opaque ID held in memory only. Set it after login with setUserId();
//   call reset() on logout so the next person on the device gets new IDs.
// - recording_id: one per client instance (page load), rotated by reset(). Each recording
//   chunk carries the session_id that was current when the chunk closed.
// Without localStorage (blocked storage, SSR) IDs live in memory for the page only.

import { RecordingChunker, type RrwebEvent } from "./chunker.ts";
import { type EventInput, parseCollectRequest, PROTOCOL_VERSION, type Properties } from "./protocol.ts";
import { type AnalyticsError, BatchQueue } from "./queue.ts";
import { DEFAULT_ALLOWED_QUERY_PARAMS, SDK_VERSION, sanitizeUrl, uuid } from "./util.ts";

export type { AnalyticsError, AnalyticsErrorCode } from "./queue.ts";
export type { JsonValue, Properties } from "./protocol.ts";
export type { RrwebEvent } from "./chunker.ts";

export { SDK_VERSION } from "./util.ts";
const SDK = `@rawtree/analytics@${SDK_VERSION}`;
const ANONYMOUS_KEY = "rawtree_analytics:anonymous_id";
const SESSION_KEY = "rawtree_analytics:session";
const ID = /^[A-Za-z0-9_:.\-]{1,128}$/;

export type AnalyticsOptions = {
  /** Collector URL, for example https://analytics.example.com/api/collect */
  endpoint: string;
  /** Opaque user ID for the signed-in user. Never an email or other personal data. */
  userId?: string;
  /** Default 5000 ms. Open recording chunks are closed and sent at this interval. */
  flushIntervalMs?: number;
  /** Default 30 minutes. */
  sessionTimeoutMs?: number;
  /** Upper bound for unsent data held in memory. Default 4 MiB; newer items are dropped. */
  maxQueueBytes?: number;
  /** Retries per batch for network errors, HTTP 408/429/5xx. Default 5. */
  maxRetries?: number;
  /** Query parameters kept in page URLs. Default: utm_source, utm_medium, utm_campaign, utm_term, utm_content. */
  allowedQueryParams?: readonly string[];
  /** "local" (default) persists IDs in localStorage; "memory" keeps them for the page only. */
  persistence?: "local" | "memory";
  /** Target size of one recording chunk before it closes. Default 64 KiB. */
  maxChunkBytes?: number;
  /** Called for dropped or rejected data. Never throws into the host application. */
  onError?: (error: AnalyticsError) => void;
  /** Custom fetch, mainly for tests. */
  fetch?: typeof fetch;
};

export type Analytics = {
  /**
   * Queue a product-defined event. Properties are JSON; null and empty objects are removed.
   * Returns the event ID, or undefined when the event was rejected locally or the client is stopped.
   */
  sendEvent(name: string, properties?: Properties): string | undefined;
  /** Queue one emitted rrweb event. Mask sensitive content before calling this. */
  sendRecording(event: RrwebEvent): void;
  setUserId(userId: string | undefined): void;
  /** Start a new anonymous ID, session, and recording (for example on logout). */
  reset(): void;
  /** Send everything queued now. Resolves when the attempt finishes; never rejects. */
  flush(): Promise<void>;
  /**
   * Drop unsent recording data (queued parts and the open chunk) and start a new recording,
   * keeping events. Use when recording consent is withdrawn but analytics consent remains.
   */
  discardRecording(): void;
  /** Consent withdrawn: discard unsent data, delete stored IDs, and ignore further calls. */
  stop(): void;
  readonly anonymousId: string;
  readonly sessionId: string;
  readonly recordingId: string;
};

type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };

function createStore(persistence: "local" | "memory"): Store {
  const memory = new Map<string, string>();
  const fallback: Store = {
    get: (key) => memory.get(key) ?? null,
    set: (key, value) => void memory.set(key, value),
    remove: (key) => void memory.delete(key),
  };
  if (persistence === "memory") return fallback;
  try {
    const storage = globalThis.localStorage;
    const probe = "rawtree_analytics:probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return {
      get: (key) => storage.getItem(key),
      set: (key, value) => {
        try {
          storage.setItem(key, value);
        } catch {
          memory.set(key, value);
        }
      },
      remove: (key) => storage.removeItem(key),
    };
  } catch {
    return fallback;
  }
}

export function createAnalytics(options: AnalyticsOptions): Analytics {
  const allowedQueryParams = options.allowedQueryParams ?? DEFAULT_ALLOWED_QUERY_PARAMS;
  const sessionTimeoutMs = options.sessionTimeoutMs ?? 30 * 60 * 1000;
  const onError = (error: AnalyticsError) => {
    try {
      options.onError?.(error);
    } catch {
      // A failing error handler must not break the host application.
    }
  };
  const store = createStore(options.persistence ?? "local");
  const queue = new BatchQueue({
    endpoint: options.endpoint,
    sdk: SDK,
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    maxQueueBytes: options.maxQueueBytes ?? 4 * 1024 * 1024,
    maxRetries: options.maxRetries ?? 5,
    onError,
  });

  let stopped = false;
  let userId = validUserId(options.userId);
  let anonymousId = store.get(ANONYMOUS_KEY) ?? "";
  if (!ID.test(anonymousId)) {
    anonymousId = uuid();
    store.set(ANONYMOUS_KEY, anonymousId);
  }
  let session = { id: "", last: 0 };
  let lastSessionWrite = 0;
  let chunker = new RecordingChunker({ recordingId: uuid(), maxChunkBytes: options.maxChunkBytes });

  function validUserId(value: string | undefined): string | undefined {
    if (value === undefined || ID.test(value)) return value;
    onError({ code: "invalid_event", message: "userId must be 1-128 characters of [A-Za-z0-9_:.-]; ignored", dropped: 0 });
    return undefined;
  }

  /** Current session, rotating it after inactivity. Activity is recorded at most once per second. */
  function touchSession(now: number): string {
    if (now - session.last > 1000 || !session.id) {
      try {
        const stored = JSON.parse(store.get(SESSION_KEY) ?? "null") as { id?: unknown; last?: unknown } | null;
        if (stored && typeof stored.id === "string" && ID.test(stored.id) && typeof stored.last === "number") {
          session = { id: stored.id, last: stored.last };
        }
      } catch {
        // Corrupt value: start a new session below.
      }
    }
    if (!session.id || now - session.last > sessionTimeoutMs) {
      session = { id: uuid(), last: now };
      lastSessionWrite = 0;
    }
    session.last = Math.max(session.last, now);
    if (now - lastSessionWrite >= 1000) {
      store.set(SESSION_KEY, JSON.stringify(session));
      lastSessionWrite = now;
    }
    return session.id;
  }

  // While the page is hidden or unloading, anything queued (for example by application
  // listeners that run after ours) gets its own small keepalive flush in a microtask.
  let leaving = false;
  let exitFlushScheduled = false;
  function afterEnqueue(): void {
    if (!leaving || exitFlushScheduled) return;
    exitFlushScheduled = true;
    queueMicrotask(() => {
      exitFlushScheduled = false;
      closeChunk();
      queue.flushOnExit();
    });
  }

  function closeChunk(): void {
    if (!chunker.hasOpenChunk) return;
    for (const part of chunker.flush(touchSession(Date.now()))) queue.enqueuePart(part);
  }

  const location = () => (typeof window === "undefined" ? undefined : window.location?.href);
  const referrer = () => (typeof document === "undefined" ? undefined : document.referrer);

  function flushNow(): Promise<void> {
    closeChunk();
    return queue.flush().catch(() => undefined);
  }

  const timer = setInterval(() => void flushNow(), options.flushIntervalMs ?? 5000);
  // Best effort: the page may be discarded after either event without further callbacks.
  const onPageHide = () => {
    leaving = true;
    closeChunk();
    queue.flushOnExit();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") onPageHide();
    else leaving = false;
  };
  const onPageShow = () => {
    leaving = false;
  };
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
  }

  return {
    sendEvent(name, properties) {
      if (stopped) return undefined;
      const now = Date.now();
      const event: EventInput = {
        event_id: uuid(),
        name,
        occurred_at: now,
        session_id: touchSession(now),
        anonymous_id: anonymousId,
        properties: properties ?? {},
      };
      const pageUrl = sanitizeUrl(location(), allowedQueryParams);
      const ref = sanitizeUrl(referrer(), allowedQueryParams);
      if (userId) event.user_id = userId;
      if (pageUrl) event.page_url = pageUrl;
      if (ref) event.referrer = ref;
      // Validate exactly like the collector so one bad event never rejects a whole batch.
      const checked = parseCollectRequest({ v: PROTOCOL_VERSION, sent_at: now, events: [event] }, now);
      if (!checked.ok) {
        onError({ code: "invalid_event", message: checked.error, dropped: 1 });
        return undefined;
      }
      queue.enqueueEvent(checked.request.events?.[0] ?? event);
      afterEnqueue();
      return event.event_id;
    },
    sendRecording(event) {
      if (stopped) return;
      if (typeof event?.type !== "number" || typeof event.timestamp !== "number") {
        onError({ code: "invalid_event", message: "sendRecording expects an rrweb event", dropped: 1 });
        return;
      }
      for (const part of chunker.push(event, touchSession(Date.now()))) queue.enqueuePart(part);
      afterEnqueue();
    },
    setUserId(value) {
      if (!stopped) userId = validUserId(value);
    },
    reset() {
      if (stopped) return;
      closeChunk();
      anonymousId = uuid();
      store.set(ANONYMOUS_KEY, anonymousId);
      session = { id: uuid(), last: Date.now() };
      store.set(SESSION_KEY, JSON.stringify(session));
      userId = undefined;
      chunker = new RecordingChunker({ recordingId: uuid(), maxChunkBytes: options.maxChunkBytes });
    },
    flush() {
      return stopped ? Promise.resolve() : flushNow();
    },
    discardRecording() {
      if (stopped) return;
      queue.discardParts();
      chunker = new RecordingChunker({ recordingId: uuid(), maxChunkBytes: options.maxChunkBytes });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      queue.stop();
      store.remove(ANONYMOUS_KEY);
      store.remove(SESSION_KEY);
      if (typeof document !== "undefined" && typeof window !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
      }
    },
    get anonymousId() {
      return anonymousId;
    },
    get sessionId() {
      return touchSession(Date.now());
    },
    get recordingId() {
      return chunker.recordingId;
    },
  };
}
