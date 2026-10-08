import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { type AnalyticsError, type AnalyticsOptions, createAnalytics } from "../src/index.ts";
import type { CollectRequest } from "../src/protocol.ts";

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const HREF = "https://shop.example/pricing?email=a%40b.test&utm_source=news#top";

type Call = { url: string; init: RequestInit; body: CollectRequest };

let store: Map<string, string>;
let doc: EventTarget & { visibilityState: string; referrer: string };
let win: EventTarget & { location: { href: string } };

beforeEach(() => {
  mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: NOW });
  store = new Map();
  doc = Object.assign(new EventTarget(), { visibilityState: "visible", referrer: "https://news.example/item?id=1" });
  win = Object.assign(new EventTarget(), { location: { href: HREF } });
  Object.assign(globalThis, {
    document: doc,
    window: win,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

afterEach(() => {
  mock.timers.reset();
  for (const key of ["document", "window", "localStorage"]) delete (globalThis as Record<string, unknown>)[key];
});

/** Fake collector: answers with the given statuses in order, then 200. */
function collector(statuses: number[] = []) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: statuses.shift() ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

function client(fetch: typeof globalThis.fetch, options: Partial<AnalyticsOptions> = {}) {
  const errors: AnalyticsError[] = [];
  const analytics = createAnalytics({
    endpoint: "https://collector.example/api/collect",
    flushIntervalMs: 3_600_000,
    fetch,
    onError: (e) => errors.push(e),
    ...options,
  });
  return { analytics, errors };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("createAnalytics", () => {
  it("batches events into one simple text/plain request with sanitized page context", async () => {
    const { calls, fetch } = collector();
    const { analytics } = client(fetch);
    analytics.sendEvent("page_view");
    analytics.sendEvent("cta_click", { cta_id: "hero_upgrade", empty: {} });
    await analytics.flush();
    assert.equal(calls.length, 1);
    assert.equal((calls[0].init.headers as Record<string, string>)["Content-Type"], "text/plain;charset=UTF-8");
    const [view, click] = calls[0].body.events ?? [];
    assert.equal(view.page_url, "https://shop.example/pricing?utm_source=news");
    assert.equal(view.referrer, "https://news.example/item");
    assert.deepEqual(click.properties, { cta_id: "hero_upgrade" });
    assert.equal(view.session_id, click.session_id);
    assert.equal(view.anonymous_id, analytics.anonymousId);
    analytics.stop();
  });

  it("retries retryable failures with the same event IDs and stops after success", async () => {
    const { calls, fetch } = collector([503, 503]);
    const { analytics } = client(fetch);
    analytics.sendEvent("signup_completed");
    await analytics.flush();
    await analytics.flush(); // still backing off: no request
    assert.equal(calls.length, 1);
    mock.timers.tick(1_500);
    await analytics.flush();
    mock.timers.tick(3_000);
    await analytics.flush();
    await analytics.flush();
    assert.equal(calls.length, 3);
    const ids = calls.map((c) => c.body.events?.[0].event_id);
    assert.equal(new Set(ids).size, 1, "retries reuse the event ID");
    analytics.stop();
  });

  it("drops rejected batches without retrying and reports them", async () => {
    const { calls, fetch } = collector([400]);
    const { analytics, errors } = client(fetch);
    analytics.sendEvent("a");
    await analytics.flush();
    mock.timers.tick(60_000);
    await analytics.flush();
    assert.equal(calls.length, 1);
    assert.deepEqual(errors.map((e) => [e.code, e.status, e.dropped]), [["rejected", 400, 1]]);
    analytics.stop();
  });

  it("gives up after maxRetries and reports the dropped batch", async () => {
    const { calls, fetch } = collector([500, 500, 500]);
    const { analytics, errors } = client(fetch, { maxRetries: 1 });
    analytics.sendEvent("a");
    await analytics.flush();
    mock.timers.tick(2_000);
    await analytics.flush();
    mock.timers.tick(60_000);
    await analytics.flush();
    assert.equal(calls.length, 2);
    assert.equal(errors[0].code, "retries_exhausted");
    analytics.stop();
  });

  it("bounds the queue and drops new items when full", async () => {
    const { fetch } = collector();
    const { analytics, errors } = client(fetch, { maxQueueBytes: 900 });
    for (let i = 0; i < 10; i++) analytics.sendEvent("product_event", { i });
    assert.ok(errors.length > 0 && errors.every((e) => e.code === "queue_full"));
    analytics.stop();
  });

  it("rejects invalid events locally so they cannot poison a batch", async () => {
    const { calls, fetch } = collector();
    const { analytics, errors } = client(fetch);
    assert.equal(analytics.sendEvent("bad<name>"), undefined);
    const id = analytics.sendEvent("good");
    await analytics.flush();
    assert.equal(errors[0].code, "invalid_event");
    assert.equal(calls[0].body.events?.[0].event_id, id, "sendEvent returns the event ID");
    assert.deepEqual(calls[0].body.events?.map((e) => e.name), ["good"]);
    analytics.stop();
  });

  it("stop() discards unsent data, deletes stored IDs, and ignores later calls", async () => {
    const { calls, fetch } = collector();
    const { analytics } = client(fetch);
    analytics.sendEvent("a");
    analytics.sendRecording({ type: 4, timestamp: NOW, data: {} });
    assert.ok(store.size > 0);
    analytics.stop();
    assert.equal(analytics.sendEvent("b"), undefined);
    await analytics.flush();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await settle();
    assert.equal(calls.length, 0);
    assert.equal(store.size, 0);
  });

  it("flushes a small keepalive batch when the page is hidden, including the open recording chunk", async () => {
    const { calls, fetch } = collector();
    const { analytics } = client(fetch);
    analytics.sendEvent("page_exit");
    analytics.sendRecording({ type: 4, timestamp: NOW, data: { href: HREF, width: 1, height: 1 } });
    analytics.sendRecording({ type: 2, timestamp: NOW, data: { node: {} } });
    for (let i = 0; i < 2000; i++) analytics.sendEvent("filler", { text: "x".repeat(200) });
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.keepalive, true);
    assert.ok(String(calls[0].init.body).length <= 60_000);
    assert.equal(calls[0].body.events?.[0].name, "page_exit");
    // The recording chunk closed on hide is queued after the events, so it is still pending.
    win.dispatchEvent(new Event("pagehide"));
    await settle();
    assert.equal(calls.length, 2);
    analytics.stop();
  });

  it("delivers events queued by application listeners that run after the SDK's page-hide handler", async () => {
    const { calls, fetch } = collector();
    const { analytics } = client(fetch);
    doc.addEventListener("visibilitychange", () => analytics.sendEvent("page_exit"));
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await settle();
    assert.deepEqual(calls.map((c) => [c.init.keepalive, c.body.events?.map((e) => e.name)]), [[true, ["page_exit"]]]);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    analytics.sendEvent("back_again");
    await settle();
    assert.equal(calls.length, 1, "no exit flushes once the page is visible again");
    analytics.stop();
  });

  it("discardRecording() drops unsent recording data, keeps events, and starts a new recording", async () => {
    const { calls, fetch } = collector();
    const { analytics } = client(fetch);
    const recordingId = analytics.recordingId;
    analytics.sendEvent("kept");
    analytics.sendRecording({ type: 4, timestamp: NOW, data: {} });
    analytics.sendRecording({ type: 2, timestamp: NOW, data: { node: { text: "x".repeat(70_000) } } });
    analytics.sendRecording({ type: 3, timestamp: NOW, data: { source: 1 } });
    analytics.discardRecording();
    await analytics.flush();
    assert.deepEqual(calls[0].body.events?.map((e) => e.name), ["kept"]);
    assert.deepEqual(calls[0].body.recording_parts, []);
    assert.notEqual(analytics.recordingId, recordingId);
    analytics.stop();
  });

  it("sends recording parts with the current recording and session IDs", async () => {
    const { calls, fetch } = collector();
    const { analytics } = client(fetch);
    analytics.sendRecording({ type: 4, timestamp: NOW, data: { href: HREF, width: 1, height: 1 } });
    analytics.sendRecording({ type: 2, timestamp: NOW, data: { node: {} } });
    analytics.sendRecording({ type: 3, timestamp: NOW + 5, data: { source: 1 } });
    await analytics.flush();
    const parts = calls[0].body.recording_parts ?? [];
    assert.equal(parts.length, 1);
    assert.equal(parts[0].recording_id, analytics.recordingId);
    assert.equal(parts[0].session_id, analytics.sessionId);
    assert.deepEqual([parts[0].has_meta, parts[0].has_full_snapshot, parts[0].event_count], [true, true, 3]);
    analytics.stop();
  });
});

describe("identity and sessions", () => {
  it("keeps IDs across instances, rotates the session after inactivity, and resets on logout", async () => {
    const { calls, fetch } = collector();
    const first = client(fetch).analytics;
    const anonymousId = first.anonymousId;
    const sessionId = first.sessionId;
    const second = client(fetch, { userId: "usr_42" }).analytics;
    assert.equal(second.anonymousId, anonymousId, "shared across tabs and reloads");
    assert.equal(second.sessionId, sessionId);

    mock.timers.tick(29 * 60 * 1000);
    assert.equal(second.sessionId, sessionId, "activity within the timeout keeps the session");
    mock.timers.tick(31 * 60 * 1000);
    const rotated = second.sessionId;
    assert.notEqual(rotated, sessionId, "inactivity starts a new session");

    second.sendEvent("before_logout");
    const recordingId = second.recordingId;
    second.reset();
    second.sendEvent("after_logout");
    await second.flush();
    const [before, after] = calls[0].body.events ?? [];
    assert.equal(before.user_id, "usr_42");
    assert.equal(after.user_id, undefined);
    assert.notEqual(after.anonymous_id, before.anonymous_id);
    assert.notEqual(after.session_id, before.session_id);
    assert.notEqual(second.recordingId, recordingId);
    first.stop();
    second.stop();
  });

  it("ignores invalid user IDs", () => {
    const { fetch } = collector();
    const { analytics, errors } = client(fetch);
    analytics.setUserId("jane@example.com");
    assert.equal(errors[0].code, "invalid_event");
    analytics.stop();
  });

  it("works without storage, keeping IDs in memory", async () => {
    delete (globalThis as Record<string, unknown>).localStorage;
    const { calls, fetch } = collector();
    const { analytics } = client(fetch);
    analytics.sendEvent("a");
    await analytics.flush();
    assert.equal(calls[0].body.events?.[0].anonymous_id, analytics.anonymousId);
    analytics.stop();
  });
});
