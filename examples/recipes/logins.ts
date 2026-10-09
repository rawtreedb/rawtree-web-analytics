// Recipe: logins = successful authentication, not a login-page visit or a submit click.
// Server: emit `login_succeeded` only after credentials were verified, with a stable
// event ID per login (`login:<loginId>`, where loginId identifies that authentication,
// for example the new session's public ID, never the session token). Failed attempts
// emit nothing here. Never put emails, passwords, tokens, or cookies in properties.
// Browser: after success (or when an existing session is found on load), attach the
// opaque account ID with setUserId(); on logout call reset() so the next person on this
// device gets a new anonymous ID, session, and recording.

import type { Analytics } from "@rawtree/analytics";
import type { BackendEvents } from "./backend-events.ts";

/** Subscriptions your app provides; each returns an unsubscribe function. */
export type AuthSignals = {
  /** The login API confirmed authentication. */
  onLoggedIn(listener: (accountId: string) => void): () => void;
  /** An existing session was found on page load. */
  onSessionRestored(listener: (accountId: string) => void): () => void;
  onLoggedOut(listener: () => void): () => void;
};

/** Browser side. `currentAccountId` covers a session that existed before tracking started. */
export function trackLogins(analytics: Analytics, auth: AuthSignals, currentAccountId?: () => string | undefined): () => void {
  const existing = currentAccountId?.();
  if (existing) analytics.setUserId(existing);
  const offs = [
    auth.onLoggedIn((accountId) => analytics.setUserId(accountId)),
    auth.onSessionRestored((accountId) => analytics.setUserId(accountId)),
    auth.onLoggedOut(() => analytics.reset()),
  ];
  return () => offs.forEach((off) => off());
}

/** Server side, called after the credentials were verified. */
export function emitLoginSucceeded(
  events: BackendEvents,
  input: { accountId: string; loginId: string; anonymousId?: string; sessionId?: string },
): Promise<boolean> {
  return events.emit(
    "login_succeeded",
    { method: "password" },
    { eventId: `login:${input.loginId}`, userId: input.accountId, anonymousId: input.anonymousId, sessionId: input.sessionId },
  );
}
