// Record synthetic rrweb sessions in system Chrome and save them as local fixtures.
// Usage: node scripts/storage-proof/record.ts
//
// Fixtures are synthetic and written to the ignored .amp/in/ directory.

import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "playwright-core";
import {
  ARTIFACT_DIR,
  COLLECT_DOM_STATS,
  type DomStats,
  FIXTURE_DIR,
  launchChrome,
  RRWEB_UMD_PATH,
  RRWEB_VERSION,
} from "./browser.ts";
import type { RrwebEvent } from "./format.ts";

export type RecordingFixture = {
  name: string;
  url: string;
  rrwebVersion: string;
  recordOptions: Record<string, unknown>;
  events: RrwebEvent[];
  finalDom: DomStats;
  sentinels: Record<string, string>;
};

// Values that must not appear in stored payloads when privacy defaults work.
const SENTINELS = {
  typedInput: "SENTINEL_INPUT_7f3a",
  typedPassword: "SENTINEL_PASSWORD_c41d",
  maskedText: "SENTINEL_TEXT_5b20",
  blockedRegion: "SENTINEL_BLOCKED_9c2e",
  attribute: "sentinel-attr@example.test",
  pageUrlQuery: "sentinel-url@example.test",
  linkQuery: "SENTINEL_LINK_TOKEN_31aa",
};

// Privacy defaults proposed by the plan: mask inputs and text, block private regions,
// and leave canvas, network, and console capture off (rrweb's defaults for the latter).
const RECORD_OPTIONS = {
  maskAllInputs: true,
  maskTextSelector: "*",
  blockClass: "rr-block",
  inlineStylesheet: true,
  recordCanvas: false,
  collectFonts: false,
};

function samplePage(rows: number, largeCss: boolean): string {
  const css = largeCss
    ? Array.from({ length: 12_000 }, (_, i) => `.generated-${i} { color: #${(i * 2654435761 % 0xffffff).toString(16).padStart(6, "0")}; margin: ${i % 13}px; }`).join("\n")
    : "";
  const tableRows = Array.from(
    { length: rows },
    (_, i) =>
      `<tr><td>${i}</td><td class="generated-${i % 12_000}">Synthetic customer row ${i} with plan ${["free", "pro", "team"][i % 3]} and a longer description for realistic DOM text volume ${"lorem ipsum ".repeat(6)}</td><td><button data-row="${i}">Open</button></td></tr>`,
  ).join("");
  return `<!doctype html>
<html><head><title>Acme Notes · Pricing</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; color: #1f2937; }
  header { display: flex; justify-content: space-between; padding: 16px 24px; background: #111827; color: white; }
  main { padding: 24px; max-width: 960px; margin: auto; }
  .plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .plan { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
  .modal { display: none; position: fixed; inset: 20% 30%; background: white; border: 2px solid #111827; padding: 24px; }
  .modal.open { display: block; }
  .spacer { height: 1400px; background: linear-gradient(#f9fafb, #e5e7eb); }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  td { border-bottom: 1px solid #eee; padding: 2px 4px; }
  ${css}
</style></head>
<body>
  <header><strong>Acme Notes</strong><nav><a href="/docs?token=${SENTINELS.linkQuery}">Docs</a> · <a href="/login">Log in</a></nav></header>
  <main>
    <h1>Choose a plan</h1>
    <p data-user-email="${SENTINELS.attribute}">Signed in visitor note: ${SENTINELS.maskedText}</p>
    <section class="plans">
      <div class="plan"><h2>Free</h2><p>For individuals.</p><button id="cta-free">Start free</button></div>
      <div class="plan"><h2>Pro</h2><p>For growing teams.</p><button id="cta-pro">Upgrade to Pro</button></div>
      <div class="plan"><h2>Team</h2><p>For organizations.</p><button id="open-modal">Contact sales</button></div>
    </section>
    <form id="signup"><label>Name <input id="name" name="name"></label>
      <label>Password <input id="password" type="password"></label>
      <button type="button" id="add">Add note</button></form>
    <ul id="notes"><li>First note</li></ul>
    <div class="rr-block"><h3>Private account panel</h3><p>${SENTINELS.blockedRegion}</p></div>
    <div class="spacer"></div>
    <table><tbody>${tableRows}</tbody></table>
  </main>
  <div class="modal" id="modal"><h2>Talk to sales</h2><button id="close-modal">Close</button></div>
  <script>
    window.__appScriptRan = true;
    let count = 1;
    document.getElementById("add").addEventListener("click", () => {
      const li = document.createElement("li");
      li.textContent = "Note " + (++count) + " added at step " + count;
      document.getElementById("notes").appendChild(li);
    });
    document.getElementById("open-modal").addEventListener("click", () => document.getElementById("modal").classList.add("open"));
    document.getElementById("close-modal").addEventListener("click", () => document.getElementById("modal").classList.remove("open"));
  </script>
</body></html>`;
}

async function recordSession(
  page: Page,
  name: string,
  html: string,
  interact: (page: Page) => Promise<void>,
): Promise<RecordingFixture> {
  const url = `https://sample.test/pricing?email=${encodeURIComponent(SENTINELS.pageUrlQuery)}&utm_source=proof#plans`;
  await page.route("https://sample.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: route.request().url().startsWith(url.split("#")[0]) ? html : "" }),
  );
  await page.goto(url);
  await page.addScriptTag({ content: readFileSync(RRWEB_UMD_PATH, "utf8") });
  await page.evaluate((options) => {
    const w = window as unknown as { __events: unknown[]; __stop?: () => void; rrweb: { record: (o: object) => () => void } };
    w.__events = [];
    w.__stop = w.rrweb.record({ ...options, emit: (event: unknown) => w.__events.push(event) });
  }, RECORD_OPTIONS);
  await interact(page);
  await page.waitForTimeout(300);
  const finalDom = (await page.evaluate(COLLECT_DOM_STATS)) as DomStats;
  await page.screenshot({ path: `${ARTIFACT_DIR}${name}-original.png` });
  const events = (await page.evaluate(() => {
    const w = window as unknown as { __events: unknown[]; __stop?: () => void };
    w.__stop?.();
    return w.__events;
  })) as RrwebEvent[];
  await page.close();
  return { name, url, rrwebVersion: RRWEB_VERSION, recordOptions: RECORD_OPTIONS, events, finalDom, sentinels: SENTINELS };
}

async function interactions(page: Page): Promise<void> {
  await page.waitForTimeout(250);
  await page.click("#cta-pro");
  for (let i = 0; i < 5; i++) {
    await page.click("#add");
    await page.waitForTimeout(80);
  }
  await page.fill("#name", SENTINELS.typedInput);
  await page.fill("#password", SENTINELS.typedPassword);
  await page.click("#open-modal");
  await page.waitForTimeout(200);
  // Periodic checkout: a second Meta + FullSnapshot pair mid-recording.
  await page.evaluate(() => (window as unknown as { rrweb: { record: { takeFullSnapshot: (b: boolean) => void } } }).rrweb.record.takeFullSnapshot(true));
  await page.click("#close-modal");
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.click("#add");
  await page.evaluate(() => window.scrollBy(0, 150));
  await page.waitForTimeout(300);
}

const browser = await launchChrome();
try {
  const newPage = () => browser.newPage({ viewport: { width: 1280, height: 800 } });
  const fixtures = [
    await recordSession(await newPage(), "interaction", samplePage(200, false), interactions),
    await recordSession(await newPage(), "large-snapshot", samplePage(9_000, true), async (p) => {
      await p.click("#add");
      await p.waitForTimeout(300);
      await p.click("#add");
      await p.evaluate(() => window.scrollTo(0, 2500));
    }),
  ];
  for (const fixture of fixtures) {
    writeFileSync(`${FIXTURE_DIR}${fixture.name}.json`, JSON.stringify(fixture));
    const sizes = fixture.events.map((e) => JSON.stringify(e).length);
    console.log(
      `${fixture.name}: ${fixture.events.length} events, ${(sizes.reduce((a, b) => a + b, 0) / 1024 / 1024).toFixed(2)} MiB JSON, largest event ${(Math.max(...sizes) / 1024 / 1024).toFixed(2)} MiB, duration ${fixture.events[fixture.events.length - 1].timestamp - fixture.events[0].timestamp} ms`,
    );
  }
} finally {
  await browser.close();
}
