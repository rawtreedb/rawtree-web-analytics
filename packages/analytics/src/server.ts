// Trusted server-side events. No browser globals; works in Node 20+, Bun, Deno, and edge
// runtimes with fetch. Requests carry a server token, so the collector marks the events
// as source "server". Keep the token in server-side configuration only.

import { type EventInput, parseCollectRequest, PROTOCOL_VERSION, type Properties } from "./protocol.ts";
import { SDK_VERSION, uuid } from "./util.ts";

export type { Properties } from "./protocol.ts";

export type ServerAnalyticsOptions = {
  /** Collector URL, for example https://analytics.example.com/api/collect */
  endpoint: string;
  /** Must equal the collector's ANALYTICS_SERVER_TOKEN. */
  token: string;
  /** Retries for network errors and HTTP 408/429/5xx. Default 2. */
  maxRetries?: number;
  /** Per-attempt timeout. Default 10 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export type ServerEventContext = {
  /**
   * Stable ID for idempotency, for example `signup:${accountId}`. Retrying with the same
   * ID never double-counts. Defaults to a random UUID per call.
   */
  eventId?: string;
  occurredAt?: number | Date;
  userId?: string;
  anonymousId?: string;
  sessionId?: string;
  pageUrl?: string;
  /** Stored as the event's user agent; the collector otherwise falls back to the request header. */
  userAgent?: string;
};

export type ServerAnalytics = {
  /** Send one event now. Rejects if the collector refuses it or stays unavailable. */
  sendEvent(name: string, properties?: Properties, context?: ServerEventContext): Promise<void>;
};

const SDK = `@rawtree/analytics@${SDK_VERSION}/server`;

export function createServerAnalytics(options: ServerAnalyticsOptions): ServerAnalytics {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const maxRetries = options.maxRetries ?? 2;
  return {
    async sendEvent(name, properties = {}, context = {}) {
      const now = Date.now();
      const occurredAt = context.occurredAt instanceof Date ? context.occurredAt.getTime() : (context.occurredAt ?? now);
      const event: EventInput = { event_id: context.eventId ?? uuid(), name, occurred_at: Math.trunc(occurredAt), properties };
      if (context.userId) event.user_id = context.userId;
      if (context.anonymousId) event.anonymous_id = context.anonymousId;
      if (context.sessionId) event.session_id = context.sessionId;
      if (context.pageUrl) event.page_url = context.pageUrl;
      if (context.userAgent) event.user_agent = context.userAgent;
      const body = { v: PROTOCOL_VERSION, sent_at: now, sdk: SDK, events: [event] };
      const checked = parseCollectRequest(body, now);
      if (!checked.ok) throw new Error(`Invalid analytics event: ${checked.error}`);

      for (let attempt = 0; ; attempt++) {
        let status = 0;
        let detail = "";
        try {
          const response = await doFetch(options.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.token}` },
            body: JSON.stringify({ ...checked.request, sent_at: Date.now() }),
            signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
          });
          if (response.ok) return;
          status = response.status;
          detail = (await response.text()).slice(0, 300);
        } catch (error) {
          detail = error instanceof Error ? error.message : String(error);
        }
        const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
        if (!retryable || attempt >= maxRetries) {
          throw new Error(`Analytics collector ${status ? `returned HTTP ${status}` : "unreachable"}: ${detail}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * 4 ** attempt));
      }
    },
  };
}
