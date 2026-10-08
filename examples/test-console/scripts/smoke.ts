// End-to-end smoke test of the test console against a local mock collector. Never contacts RawTree.
//
//   npm run smoke      (vite build && node scripts/smoke.ts)
//
// Starts a mock collector (validates bodies with the packed SDK's parseCollectRequest), starts
// the console server with CONSOLE_ENV_FILE=none pointing at it, drives the UI in headless system
// Chrome with the repository root's playwright-core, and asserts on the captured requests.
//
// Env: SMOKE_COLLECTOR_PORT (3999), SMOKE_APP_PORT (5199), SMOKE_SERVER_TOKEN (dummy token),
//      SMOKE_SCREENSHOT (optional PNG path, taken before analytics is turned off),
//      SMOKE_FORWARD_TO (optional real collector URL: every valid request is also forwarded there
//      with its Origin/Authorization headers and must be accepted. The real collector must allow
//      the console origin, e.g. SMOKE_APP_PORT=5173, and SMOKE_SERVER_TOKEN must equal its
//      ANALYTICS_SERVER_TOKEN. The injected failure is answered locally and not forwarded.)

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { join } from "node:path";
import { type EventRow, parseCollectRequest, type RecordingRow, toRows } from "@rawtree/analytics/protocol";
import { chromium, type Page } from "playwright-core";

const COLLECTOR_PORT = Number(process.env.SMOKE_COLLECTOR_PORT ?? 3999);
const APP_PORT = Number(process.env.SMOKE_APP_PORT ?? 5199);
const APP = `http://localhost:${APP_PORT}`;
const COLLECTOR_URL = `http://localhost:${COLLECTOR_PORT}/api/collect`;
const TOKEN = process.env.SMOKE_SERVER_TOKEN ?? "smoke-dummy-server-token";
const FORWARD_TO = process.env.SMOKE_FORWARD_TO;
const TYPED = "TYPED_SENTINEL_777";
const SENTINELS = ["sk_test_SENTINEL_123", "SENTINEL_URL", "jane.doe@example.com", TYPED];
const BROWSER_BUTTONS = ["page_view", "cta_click", "scroll_depth", "time_on_page", "web_vital", "project_created", "feature_used"];

type Received = { at: number; status: number; auth?: string; raw: string; events: EventRow[]; recordings: RecordingRow[] };
const received: Received[] = [];
let failNext = 0; // answer the next N valid browser requests with 503

async function forward(raw: string, headers: IncomingHttpHeaders): Promise<number> {
  if (!FORWARD_TO) return 200;
  const out: Record<string, string> = { "content-type": String(headers["content-type"] ?? "text/plain;charset=UTF-8") };
  if (typeof headers.origin === "string") out.origin = headers.origin;
  if (typeof headers.authorization === "string") out.authorization = headers.authorization;
  const response = await fetch(FORWARD_TO, { method: "POST", headers: out, body: raw });
  if (!response.ok) console.error("real collector answered", response.status, await response.text());
  return response.status;
}

// ---------- mock collector ----------
const collector = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors: Record<string, string> = origin === APP ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" }).end();
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const at = Date.now();
  const auth = req.headers.authorization;
  const reply = (status: number, body: object, rows: { events: EventRow[]; recordings: RecordingRow[] } = { events: [], recordings: [] }) => {
    received.push({ at, status, auth, raw, ...rows });
    res.writeHead(status, { "Content-Type": "application/json", ...cors }).end(JSON.stringify(body));
  };
  if (auth !== undefined && auth !== `Bearer ${TOKEN}`) return reply(401, { error: "unauthorized", message: "bad token" });
  if (auth === undefined && !cors["Access-Control-Allow-Origin"]) return reply(403, { error: "origin_not_allowed", message: "origin" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "invalid_json", message: "body is not JSON" });
  }
  const parsed = parseCollectRequest(body, at);
  if (!parsed.ok) {
    console.error("invalid request:", parsed.error);
    return reply(400, { error: "invalid_request", message: parsed.error });
  }
  const rows = toRows(parsed.request, { receivedAt: at, source: auth ? "server" : "browser" });
  if (!auth && failNext > 0) {
    failNext--;
    return reply(503, { error: "storage_unavailable", message: "injected failure" }, rows);
  }
  const forwarded = await forward(raw, req.headers);
  if (forwarded !== 200) return reply(forwarded, { error: "forward_failed", message: `real collector answered ${forwarded}` }, rows);
  reply(200, { accepted: rows.events.length + rows.recordings.length }, rows);
});

// ---------- checks ----------
const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  results.push({ name, ok, detail: ok || detail === undefined ? undefined : JSON.stringify(detail).slice(0, 600) });
}

const okBrowser = () => received.filter((r) => r.status === 200 && !r.auth);
const eventRequests = (id: string) => received.filter((r) => r.events.some((e) => e.event_id === id));
const stateOf = (page: Page, id: string, col: string) => page.locator(`tr[data-id="${id}"] [data-col="${col}"]`).first().getAttribute("data-state");
const waitState = (page: Page, id: string, col: string, state: string, timeout = 12_000) =>
  page.waitForFunction(
    ([id, col, state]) => document.querySelector(`tr[data-id="${id}"] [data-col="${col}"]`)?.getAttribute("data-state") === state,
    [id, col, state] as const,
    { timeout },
  );
const newestId = async (page: Page, name: string) => (await page.locator(`tr[data-kind="event"][data-name="${name}"]`).first().getAttribute("data-id")) ?? "";

let app: ChildProcess | undefined;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  collector.listen(COLLECTOR_PORT);
  await once(collector, "listening");

  app = spawn(process.execPath, ["server.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env,
      CONSOLE_ENV_FILE: "none",
      PORT: String(APP_PORT),
      COLLECTOR_URL,
      ANALYTICS_SERVER_TOKEN: TOKEN,
      RAWTREE_DATABASE: "smoke_db",
      RAWTREE_QUERY_KEY: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    app?.stdout?.on("data", (data: Buffer) => data.toString().includes("listening") && resolve());
    app?.once("exit", (code) => reject(new Error(`console server exited with ${code}`)));
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const recorderLoads: number[] = [];
  page.on("request", (request) => {
    if (/\/assets\/recorder-/.test(request.url())) recorderLoads.push(Date.now());
  });
  page.on("pageerror", (error) => check(`no page errors (${error.message})`, false));
  const flush = () => page.click("text=Flush now");

  // 1. Before consent: nothing is sent.
  await page.goto(APP);
  await page.waitForFunction((url) => document.querySelector('[data-testid="collector-url"]')?.textContent === url, COLLECTOR_URL);
  await page.waitForTimeout(2500);
  check("nothing is sent before consent", received.length === 0, received.length);
  check("no analytics IDs are stored before consent", (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rawtree_analytics:")))).length === 0);
  check("browser buttons are disabled before consent", await page.locator('[data-action="page_view"]').isDisabled());

  // 2. Analytics consent; every recipe button reaches Sent with the right event_id.
  await page.click("#consent-analytics");
  await page.waitForFunction(() => document.querySelector('[data-testid="anonymous-id"]')?.textContent !== "—");
  const anonymousId = (await page.textContent('[data-testid="anonymous-id"]')) ?? "";
  const ids: Record<string, string> = {};
  for (const name of BROWSER_BUTTONS) {
    await page.click(`[data-action="${name}"]`);
    ids[name] = await newestId(page, name);
  }
  check("each browser button adds a Queued row with an event_id", BROWSER_BUTTONS.every((name) => /^[0-9a-f-]{36}$/.test(ids[name])), ids);
  for (const name of BROWSER_BUTTONS) await waitState(page, ids[name], "sent", "sent");
  const browserEvents = okBrowser().flatMap((r) => r.events);
  check(
    "each browser row reaches Sent and the collector got that event_id and name",
    BROWSER_BUTTONS.every((name) => browserEvents.some((e) => e.event_id === ids[name] && e.event_name === name)),
    browserEvents.map((e) => `${e.event_name}:${e.event_id}`),
  );
  const props = (name: string) => browserEvents.find((e) => e.event_id === ids[name])?.properties ?? {};
  check("cta_click has cta_id and placement", props("cta_click").cta_id === "pricing_start_trial" && props("cta_click").placement === "pricing_table", props("cta_click"));
  check("web_vital has metric_name, metric_id, value, delta, rating", ["metric_name", "metric_id", "value", "delta", "rating"].every((k) => k in props("web_vital")), props("web_vital"));
  check("browser events carry the shown anonymous_id", browserEvents.every((e) => e.anonymous_id === anonymousId && e.source === "browser"));

  // 3. Injected collector failure: the row shows the status code, then recovers on retry.
  failNext = 1;
  await page.click('[data-action="feature_used"]');
  const retriedId = await newestId(page, "feature_used");
  await flush();
  await waitState(page, retriedId, "sent", "failed");
  const failedText = (await page.locator(`tr[data-id="${retriedId}"] [data-col="sent"]`).textContent()) ?? "";
  check("failed delivery shows the status code and the collector error", failedText.includes("503") && failedText.includes("storage_unavailable"), failedText);
  await waitState(page, retriedId, "sent", "sent", 20_000);
  const tries = eventRequests(retriedId).map((r) => r.status);
  check("retry reuses the event_id and recovers to Sent", JSON.stringify(tries) === "[503,200]", tries);
  check("SDK did not report an error for a recovered retry", (await page.locator('tr[data-kind="error"]').count()) === 0);

  // 4. Custom event: invalid JSON shows an error and sends nothing; valid JSON is sent.
  const rowsBefore = await page.locator('tr[data-kind="event"]').count();
  const requestsBefore = received.length;
  await page.fill("#custom-properties", "{ not json");
  await page.click("#custom-send");
  const customError = (await page.textContent('[data-testid="custom-error"]')) ?? "";
  await flush();
  await page.waitForTimeout(800);
  check("invalid custom JSON shows an error", customError.startsWith("Invalid JSON"), customError);
  check("invalid custom JSON sends nothing", received.length === requestsBefore && (await page.locator('tr[data-kind="event"]').count()) === rowsBefore);
  await page.fill("#custom-name", "checkout_started");
  await page.fill("#custom-properties", '{"plan": "pro", "seats": 3}');
  await page.click("#custom-send");
  const customId = await newestId(page, "checkout_started");
  await waitState(page, customId, "sent", "sent");
  check("valid custom event is sent with its properties", eventRequests(customId).some((r) => r.events.some((e) => e.properties.seats === 3)));
  await page.fill("#custom-name", "bad name!");
  await page.click("#custom-send");
  await page.waitForSelector('tr[data-kind="error"][data-id="invalid_event"]');
  check("SDK onError invalid_event appears as a viewer row", true);

  // 5. Server events: Authorization header, stable IDs, resend keeps the same event_id.
  await page.click('[data-action="signup_completed"]');
  await page.waitForFunction(() => /^signup:acct_/.test(document.querySelector('tr[data-name="signup_completed"]')?.getAttribute("data-id") ?? ""));
  const signupId = await newestId(page, "signup_completed");
  await waitState(page, signupId, "sent", "sent");
  await page.click("#server-resend");
  await page.waitForFunction((id) => document.querySelector(`tr[data-id="${id}"]`)?.textContent?.includes("×2"), signupId);
  await waitState(page, signupId, "sent", "sent");
  const signupRequests = eventRequests(signupId);
  check("server events reach the collector with Authorization: Bearer <token>", signupRequests.length > 0 && signupRequests.every((r) => r.auth === `Bearer ${TOKEN}`));
  check("resend uses the same event_id (two requests, one ID)", signupRequests.length === 2 && signupRequests.every((r) => r.events[0].event_id === signupId), signupRequests.map((r) => r.events[0]?.event_id));
  check("server event has source=server and user_id from the ID", signupRequests[0]?.events[0]?.source === "server" && signupRequests[0]?.events[0]?.user_id === signupId.slice("signup:".length));
  check("resend updates the existing row instead of adding one", (await page.locator(`tr[data-id="${signupId}"]`).count()) === 1);
  for (const name of ["login_succeeded", "export_completed"]) {
    await page.click(`[data-action="${name}"]`);
    await page.waitForFunction((n) => (document.querySelector(`tr[data-name="${n}"]`)?.getAttribute("data-id") ?? "").includes(":"), name);
    await waitState(page, await newestId(page, name), "sent", "sent");
  }
  const serverIds = received.filter((r) => r.auth).map((r) => r.events[0]?.event_id);
  check("login and export use login:login_* and export:exp_* IDs", serverIds.some((id) => /^login:login_/.test(id)) && serverIds.some((id) => /^export:exp_/.test(id)), serverIds);
  check("browser requests never carry Authorization", received.filter((r) => !r.auth).length > 0 && !received.some((r) => !r.auth && r.raw.includes(TOKEN)));

  // 6. Storage check is not configured (no query key).
  const storedStates = await page.locator('tr[data-kind="event"] [data-col="stored"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-state")));
  check("every stored column shows 'not configured' without a query key", storedStates.length > 0 && storedStates.every((s) => s === "unconfigured"), storedStates);
  const storedApi = await page.evaluate(async () => (await fetch("/api/stored", { method: "POST", body: JSON.stringify({ eventIds: ["a"], recordingIds: [] }) })).json());
  check("/api/stored answers {configured:false}", JSON.stringify(storedApi) === '{"configured":false}', storedApi);
  const config = await page.evaluate(async () => (await fetch("/api/config")).text());
  check("/api/config never returns the server token", !config.includes(TOKEN) && config.includes('"serverEvents":true') && config.includes('"storageCheck":false'), config);

  // 7. Recording: parts only after recording consent; sentinels never leave the page.
  check("no recording parts and no recorder chunk before recording consent", received.every((r) => r.recordings.length === 0) && recorderLoads.length === 0);
  const recordingConsentAt = Date.now();
  await page.click("#consent-recording");
  await page.waitForFunction(() => document.querySelector('[data-testid="recording-badge"]')?.textContent?.trim() === "recording");
  await page.click("#add-item");
  await page.click("#toggle-panel");
  await page.fill("#masked-input", TYPED);
  await page.click("#toggle-panel");
  await page.click("#add-item");
  await flush();
  const recordingId = (await page.textContent('[data-testid="recording-id"]')) ?? "";
  await waitState(page, recordingId, "sent", "sent");
  await page.waitForTimeout(2500); // one more interval so the latest chunk is sent too
  await flush();
  await page.waitForTimeout(500);
  const parts = okBrowser().flatMap((r) => r.recordings);
  const uniqueParts = new Set(parts.filter((p) => p.recording_id === recordingId).map((p) => `${p.chunk_seq}:${p.part_index}`)).size;
  const recordingRow = (await page.locator(`tr[data-id="${recordingId}"] [data-col="sent"]`).textContent()) ?? "";
  check("recorder chunk loads only after recording consent", recorderLoads.length > 0 && recorderLoads.every((t) => t >= recordingConsentAt), recorderLoads.map((t) => t - recordingConsentAt));
  check("recording parts arrive only after recording consent", parts.length > 0 && received.filter((r) => r.recordings.length > 0).every((r) => r.at >= recordingConsentAt));
  check("first chunk has meta and full snapshot", parts.some((p) => p.chunk_seq === 0 && p.has_meta && p.has_full_snapshot));
  check("recording row shows the parts sent", recordingRow.startsWith(`${uniqueParts} parts sent`), { recordingRow, uniqueParts });
  check("recording row storage shows 'not configured'", (await stateOf(page, recordingId, "stored")) === "unconfigured");
  const leaked = SENTINELS.filter((s) => received.some((r) => r.raw.includes(s)));
  check("masked/blocked sentinels never appear in any payload", leaked.length === 0, leaked);

  if (process.env.SMOKE_SCREENSHOT) {
    await page.locator(`tr[data-id="${ids.cta_click}"]`).click();
    await page.screenshot({ path: process.env.SMOKE_SCREENSHOT, fullPage: true });
  }

  // 8. Analytics off: nothing more is sent and stored IDs are gone.
  await page.click("#consent-analytics");
  const offAt = Date.now();
  await page.click("#add-item");
  await page.click("#toggle-panel");
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(4500);
  const after = received.filter((r) => !r.auth && r.at > offAt);
  check("nothing is sent after analytics is turned off", after.length === 0, after.map((r) => r.raw.slice(0, 200)));
  check("stored analytics IDs are deleted when analytics is turned off", (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rawtree_analytics:")))).length === 0);
  check("recording consent is cleared with analytics", (await page.getAttribute("#consent-recording", "aria-checked")) === "false");

  console.log(`requests: ${received.length} (${received.filter((r) => r.auth).length} server); events: ${received.flatMap((r) => r.events).length}; recording parts: ${parts.length}`);
} catch (error) {
  check(`smoke flow completed (${error instanceof Error ? error.message : String(error)})`, false);
} finally {
  await browser.close();
  app?.kill();
  collector.close();
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? `\n     ${r.detail}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
