// Server events for the test console: runs the real server SDK (createServerAnalytics)
// against the collector logic in-process, with a one-off token and the visitor's
// credentials. No shared server token and no network hop. Body: { name, properties, eventId? }.

import { randomBytes } from "node:crypto";
import { createServerAnalytics, type Properties } from "@rawtree/analytics/server";
import { getAccess } from "../../../../lib/access.ts";
import { handleCollect } from "../../../../lib/collect.ts";

/** Stable, outcome-derived IDs like the recipes use (signup:<accountId>, login:<loginId>, ...). */
const ID_PREFIX: Record<string, [string, string]> = {
  signup_completed: ["signup", "acct"],
  login_succeeded: ["login", "login"],
  export_completed: ["export", "exp"],
};

export async function POST(request: Request): Promise<Response> {
  const access = await getAccess();
  if (!access) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  // Like /api/console/collect: only the console page itself may send.
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ ok: false, error: "Origin is not allowed." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { name?: unknown; properties?: unknown; eventId?: unknown };
  const name = typeof body.name === "string" ? body.name : "";
  const properties = body.properties;
  if (!name || name.length > 128) return Response.json({ ok: false, error: "name is required" }, { status: 400 });
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return Response.json({ ok: false, error: "properties must be an object" }, { status: 400 });
  }
  const [prefix, kind] = ID_PREFIX[name] ?? [name.replace(/[^A-Za-z0-9_]/g, "_"), "evt"];
  const eventId = typeof body.eventId === "string" ? body.eventId : `${prefix}:${kind}_${randomBytes(9).toString("hex")}`; // the SDK validates it
  const userId = kind === "acct" ? eventId.slice(prefix.length + 1) : undefined;

  // Capture the request as sent and the collector's answer to show them in the console.
  const token = randomBytes(24).toString("hex");
  let sent: unknown;
  let status: number | undefined;
  const analytics = createServerAnalytics({
    endpoint: new URL("/api/console/collect", request.url).href,
    token,
    maxRetries: 0,
    fetch: async (input, init) => {
      if (typeof init?.body === "string") sent = JSON.parse(init.body);
      const response = await handleCollect(new Request(input, init), { rawtree: access.ingest, allowedOrigins: [], serverToken: token });
      status = response.status;
      return response;
    },
  });
  try {
    await analytics.sendEvent(name, properties as Properties, { eventId, userId });
    return Response.json({ eventId, ok: true, status, request: sent });
  } catch (error) {
    return Response.json({ eventId, ok: false, status, error: error instanceof Error ? error.message : String(error), request: sent });
  }
}
