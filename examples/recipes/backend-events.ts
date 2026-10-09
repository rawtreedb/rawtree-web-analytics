// Recipe: authoritative backend events.
// Business outcomes (account created, login succeeded, export finished) are emitted from
// trusted server code with a server-held token, so the collector stores them with
// source = "server". Each call passes a stable, outcome-derived event ID such as
// `export:<exportId>`: SDK retries and application-level retries of the same outcome
// reuse the ID, and queries deduplicate on event_id.
//
// Emission here is fire-and-forget after the business action succeeded: an analytics
// outage never fails the user's request, and an exhausted retry is logged and lost.
// When losing an outcome is unacceptable, write it to a durable outbox in the same
// transaction as the business change and deliver from there with the same event ID.

import { createServerAnalytics, type Properties, type ServerEventContext } from "@rawtree/analytics/server";

export type BackendEventContext = ServerEventContext & { eventId: string };

export type BackendEvents = {
  readonly enabled: boolean;
  /** Send one authoritative event. Resolves to false when disabled or delivery failed. Never rejects. */
  emit(name: string, properties: Properties, context: BackendEventContext): Promise<boolean>;
};

export type BackendEventsOptions = {
  endpoint: string;
  /** Collector ANALYTICS_SERVER_TOKEN. When missing, events are skipped and logged once. */
  token: string | undefined;
  log?: Pick<Console, "info" | "warn" | "error">;
  fetch?: typeof fetch;
};

export function createBackendEvents(options: BackendEventsOptions): BackendEvents {
  const log = options.log ?? console;
  if (!options.token) {
    log.warn("ANALYTICS_SERVER_TOKEN is not set: backend analytics events are skipped.");
    return { enabled: false, emit: async () => false };
  }
  const client = createServerAnalytics({ endpoint: options.endpoint, token: options.token, fetch: options.fetch });
  return {
    enabled: true,
    async emit(name, properties, context) {
      try {
        await client.sendEvent(name, properties, context);
        return true;
      } catch (error) {
        log.error(`analytics event ${name} (${context.eventId}) was not delivered:`, error instanceof Error ? error.message : error);
        return false;
      }
    },
  };
}

/** Example product outcome: an export finished on the server. */
export function emitExportCompleted(
  events: BackendEvents,
  input: { exportId: string; accountId: string; format: string; link?: Pick<ServerEventContext, "anonymousId" | "sessionId"> },
): Promise<boolean> {
  return events.emit(
    "export_completed",
    { format: input.format },
    { eventId: `export:${input.exportId}`, userId: input.accountId, ...input.link },
  );
}
