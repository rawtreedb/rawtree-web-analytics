// Recipe: signups = confirmed account creation, not a submit-button click.
// Server: after the account is stored, emit the authoritative `signup_completed` with
// `eventId: "signup:<accountId>"` (one account, one event, however often it is retried)
// and `userId: accountId`. Never put the email, password, or name in properties.
// Browser: only after the API confirms success, attach the opaque account ID to later
// browser events with setUserId(). The browser does NOT emit signup_completed, so there
// is exactly one authoritative source.

import type { Analytics } from "@rawtree/analytics";
import type { BackendEvents } from "./backend-events.ts";

/**
 * Browser side. `onAccountCreated` is your app's subscription to "the signup API confirmed
 * that the account exists"; it returns an unsubscribe function.
 */
export function trackSignups(analytics: Analytics, onAccountCreated: (listener: (accountId: string) => void) => () => void): () => void {
  return onAccountCreated((accountId) => analytics.setUserId(accountId));
}

/** Server side, called after the account was created. */
export function emitSignupCompleted(
  events: BackendEvents,
  input: { accountId: string; plan: string; anonymousId?: string; sessionId?: string },
): Promise<boolean> {
  return events.emit(
    "signup_completed",
    { plan: input.plan, method: "password" },
    { eventId: `signup:${input.accountId}`, userId: input.accountId, anonymousId: input.anonymousId, sessionId: input.sessionId },
  );
}
