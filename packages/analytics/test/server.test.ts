import assert from "node:assert/strict";
import { it } from "node:test";
import { createServerAnalytics } from "../src/server.ts";

function collector(statuses: number[]) {
  const calls: { headers: Record<string, string>; body: { events: { event_id: string; occurred_at: number }[] } }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: statuses.shift() ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

it("runs without browser globals", () => {
  assert.equal(typeof (globalThis as Record<string, unknown>).window, "undefined");
});

it("authenticates, retries with the same idempotent event ID, then succeeds", async () => {
  const { calls, fetch } = collector([503]);
  const analytics = createServerAnalytics({ endpoint: "https://c.example/api/collect", token: "secret", fetch });
  await analytics.sendEvent("signup_completed", { plan: "pro" }, { eventId: "signup:acct_1", userId: "usr_1", occurredAt: new Date(Date.UTC(2026, 0, 1)) });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.Authorization, "Bearer secret");
  assert.deepEqual(calls.map((c) => c.body.events[0].event_id), ["signup:acct_1", "signup:acct_1"]);
  assert.equal(calls[0].body.events[0].occurred_at, Date.UTC(2026, 0, 1));
});

it("rejects invalid events before sending and surfaces collector rejections", async () => {
  const { calls, fetch } = collector([400]);
  const analytics = createServerAnalytics({ endpoint: "https://c.example/api/collect", token: "secret", fetch });
  await assert.rejects(analytics.sendEvent("bad<name>"), /Invalid analytics event/);
  assert.equal(calls.length, 0);
  await assert.rejects(analytics.sendEvent("ok"), /HTTP 400/);
  assert.equal(calls.length, 1);
});
