// Bounded in-memory batching queue with one request in flight, size-aware batches,
// bounded retries with backoff, and a small keepalive flush for page exit.
// Items keep their IDs across retries; the collector and readers deduplicate.

import { type CollectRequest, type EventInput, LIMITS, PROTOCOL_VERSION, type RecordingPartInput, utf8Length } from "./protocol.ts";
import { jsonStringLength } from "./util.ts";

export type AnalyticsErrorCode = "invalid_event" | "queue_full" | "rejected" | "retries_exhausted";

export type AnalyticsError = {
  code: AnalyticsErrorCode;
  message: string;
  /** Number of events or recording parts that were dropped. */
  dropped: number;
  status?: number;
};

type Item =
  | { kind: "event"; body: EventInput; bytes: number }
  | { kind: "part"; body: RecordingPartInput; bytes: number };

export type QueueOptions = {
  endpoint: string;
  sdk: string;
  fetch: typeof fetch;
  maxQueueBytes: number;
  maxRetries: number;
  onError: (error: AnalyticsError) => void;
};

const ENVELOPE_BYTES = 256;
/** HTTP statuses worth retrying; shared with the server entry. */
export const RETRYABLE = (status: number) => status === 408 || status === 429 || status >= 500;

export class BatchQueue {
  private items: Item[] = [];
  private queuedBytes = 0;
  private inFlight: Promise<void> | undefined;
  private failures = 0;
  private retryAt = 0;
  private stopped = false;
  /** Incremented by discardParts() so failed in-flight parts are not put back afterwards. */
  private partsEpoch = 0;

  private readonly options: QueueOptions;

  constructor(options: QueueOptions) {
    this.options = options;
  }

  get size(): number {
    return this.items.length;
  }

  get bytes(): number {
    return this.queuedBytes;
  }

  enqueueEvent(body: EventInput): void {
    this.enqueue({ kind: "event", body, bytes: utf8Length(JSON.stringify(body)) + 1 });
  }

  enqueuePart(body: RecordingPartInput): void {
    // Same as utf8Length(JSON.stringify(body)) + 1, without re-escaping the large payload.
    const bytes = utf8Length(JSON.stringify({ ...body, payload: "" })) - 2 + jsonStringLength(body.payload) + 1;
    this.enqueue({ kind: "part", body, bytes });
  }

  private enqueue(item: Item): void {
    if (this.stopped) return;
    // Drop new items when full: keeping the oldest recording parts keeps their snapshot replayable.
    if (this.queuedBytes + item.bytes > this.options.maxQueueBytes) {
      this.options.onError({ code: "queue_full", message: "Analytics queue is full; item dropped", dropped: 1 });
      return;
    }
    this.items.push(item);
    this.queuedBytes += item.bytes;
  }

  /** Send queued items in batches until empty, a failure, or an active backoff. */
  flush(now = Date.now()): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (this.items.length === 0 || now < this.retryAt) return Promise.resolve();
    this.inFlight = this.drain().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    while (!this.stopped && this.items.length > 0 && Date.now() >= this.retryAt) {
      const epoch = this.partsEpoch;
      const batch = this.take(LIMITS.maxRequestBytes);
      const outcome = await this.send(batch, false);
      if (outcome === "sent") {
        this.failures = 0;
        continue;
      }
      if (outcome === "retry") {
        this.failures++;
        if (this.failures > this.options.maxRetries) {
          this.failures = 0;
          this.options.onError({
            code: "retries_exhausted",
            message: `Collector unavailable after ${this.options.maxRetries} retries; batch dropped`,
            dropped: batch.length,
          });
        } else {
          this.putBack(batch, epoch);
          this.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** (this.failures - 1)) * (0.75 + Math.random() * 0.5);
        }
      }
      return;
    }
  }

  /** Best-effort page-exit flush: one keepalive request with whatever fits its size limit. */
  flushOnExit(): void {
    if (this.stopped || this.items.length === 0) return;
    const epoch = this.partsEpoch;
    const batch = this.take(LIMITS.maxKeepaliveRequestBytes);
    if (batch.length === 0) return;
    void this.send(batch, true).then((outcome) => {
      if (outcome === "retry") this.putBack(batch, epoch);
    });
  }

  /** Drop queued recording parts and keep events. Parts already in flight are unaffected. */
  discardParts(): void {
    this.partsEpoch++;
    this.items = this.items.filter((item) => item.kind === "event");
    this.queuedBytes = this.items.reduce((sum, item) => sum + item.bytes, 0);
  }

  /** Discard everything queued and ignore further items (consent withdrawn). */
  stop(): void {
    this.stopped = true;
    this.items = [];
    this.queuedBytes = 0;
  }

  private take(maxRequestBytes: number): Item[] {
    let bytes = ENVELOPE_BYTES;
    let events = 0;
    let parts = 0;
    let count = 0;
    for (const item of this.items) {
      const full =
        bytes + item.bytes > maxRequestBytes ||
        (item.kind === "event" ? events >= LIMITS.maxEventsPerRequest : parts >= LIMITS.maxRecordingPartsPerRequest);
      if (full) break;
      bytes += item.bytes;
      if (item.kind === "event") events++;
      else parts++;
      count++;
    }
    this.queuedBytes -= bytes - ENVELOPE_BYTES;
    return this.items.splice(0, count);
  }

  private putBack(batch: Item[], epoch: number): void {
    if (this.stopped) return;
    const kept = epoch === this.partsEpoch ? batch : batch.filter((item) => item.kind === "event");
    this.items.unshift(...kept);
    this.queuedBytes += kept.reduce((sum, item) => sum + item.bytes, 0);
  }

  private async send(batch: Item[], keepalive: boolean): Promise<"sent" | "retry" | "rejected"> {
    const request: CollectRequest = {
      v: PROTOCOL_VERSION,
      sent_at: Date.now(),
      sdk: this.options.sdk,
      events: batch.flatMap((item) => (item.kind === "event" ? [item.body] : [])),
      recording_parts: batch.flatMap((item) => (item.kind === "part" ? [item.body] : [])),
    };
    let response: Response;
    try {
      response = await this.options.fetch(this.options.endpoint, {
        method: "POST",
        // text/plain keeps cross-origin requests "simple" (no CORS preflight).
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(request),
        keepalive,
        credentials: "omit",
      });
    } catch {
      return "retry";
    }
    if (response.ok) return "sent";
    if (RETRYABLE(response.status)) return "retry";
    this.options.onError({
      code: "rejected",
      message: `Collector rejected the batch with HTTP ${response.status}`,
      dropped: batch.length,
      status: response.status,
    });
    return "rejected";
  }
}
