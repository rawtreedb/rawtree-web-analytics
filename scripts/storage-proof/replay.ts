// Replay recordings with rrweb's Replayer in system Chrome and compare the final
// replayed DOM with the DOM captured from the original page.
// Usage: node scripts/storage-proof/replay.ts [events.json ...]
// Without arguments it replays every fixture and every *.roundtrip.json file.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import {
  ARTIFACT_DIR,
  COLLECT_DOM_STATS,
  type DomStats,
  FIXTURE_DIR,
  launchChrome,
  RRWEB_CSS_PATH,
  RRWEB_UMD_PATH,
} from "./browser.ts";
import type { RrwebEvent } from "./format.ts";
import type { RecordingFixture } from "./record.ts";

type ReplayResult = {
  file: string;
  fixture: string;
  events: number;
  matchesOriginalDom: boolean;
  differences: string[];
  appScriptExecutedInReplay: boolean;
  screenshot: string;
};

function compare(original: DomStats, replayed: DomStats): string[] {
  const differences: string[] = [];
  const tags = new Set([...Object.keys(original.tags), ...Object.keys(replayed.tags)]);
  for (const tag of tags) {
    if ((original.tags[tag] ?? 0) !== (replayed.tags[tag] ?? 0)) {
      differences.push(`<${tag}> original ${original.tags[tag] ?? 0}, replay ${replayed.tags[tag] ?? 0}`);
    }
  }
  if (original.textLength !== replayed.textLength) {
    differences.push(`text length original ${original.textLength}, replay ${replayed.textLength}`);
  }
  if (original.scrollY !== replayed.scrollY) differences.push(`scrollY original ${original.scrollY}, replay ${replayed.scrollY}`);
  if (original.width !== replayed.width) differences.push(`viewport width original ${original.width}, replay ${replayed.width}`);
  return differences;
}

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(FIXTURE_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => `${FIXTURE_DIR}${f}`);

const browser = await launchChrome();
const results: ReplayResult[] = [];
try {
  for (const file of files) {
    const fixtureName = basename(file).split(".")[0];
    const fixture = JSON.parse(readFileSync(`${FIXTURE_DIR}${fixtureName}.json`, "utf8")) as RecordingFixture;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as RecordingFixture | { events: RrwebEvent[] };
    const events = parsed.events;
    const lastMeta = [...events].reverse().find((e) => e.type === 4)?.data as { width: number; height: number };

    const page = await browser.newPage({ viewport: { width: lastMeta.width + 40, height: lastMeta.height + 40 } });
    await page.setContent(`<!doctype html><html><head><style>${readFileSync(RRWEB_CSS_PATH, "utf8")} body{margin:0}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: readFileSync(RRWEB_UMD_PATH, "utf8") });
    // Play to the end instead of seeking: rrweb's seek (pause(offset)) re-applies the
    // latest Meta size after later viewport resizes, which real playback does not.
    await page.evaluate(async (replayEvents) => {
      type Replayer = { play: (t: number) => void; on: (e: string, cb: () => void) => void };
      const w = window as unknown as { rrweb: { Replayer: new (e: unknown[], o: object) => Replayer } };
      const replayer = new w.rrweb.Replayer(replayEvents, {
        root: document.getElementById("root"),
        mouseTail: false,
        showWarning: false,
        speed: 4,
      });
      const finished = new Promise<void>((resolve) => replayer.on("finish", resolve));
      replayer.play(0);
      await finished;
    }, events);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (!frame) throw new Error(`No replay iframe for ${file}`);
    // Live playback applies scroll with smooth behaviour; wait until it settles.
    for (let previous = -1, i = 0; i < 25; i++) {
      await page.waitForTimeout(200);
      const current = await frame.evaluate(() => window.scrollY);
      if (current === previous) break;
      previous = current;
    }
    const replayed = (await frame.evaluate(COLLECT_DOM_STATS)) as DomStats;
    const appScriptExecutedInReplay = await frame.evaluate(() => "__appScriptRan" in window);
    const screenshot = `${ARTIFACT_DIR}${basename(file, ".json")}-replay.png`;
    await page.locator("iframe").screenshot({ path: screenshot });
    await page.close();

    const differences = compare(fixture.finalDom, replayed);
    results.push({
      file: basename(file),
      fixture: fixtureName,
      events: events.length,
      matchesOriginalDom: differences.length === 0,
      differences,
      appScriptExecutedInReplay,
      screenshot: basename(screenshot),
    });
  }
} finally {
  await browser.close();
}

writeFileSync(`${ARTIFACT_DIR}replay-results.json`, JSON.stringify(results, null, 2));
console.table(
  results.map(({ file, events, matchesOriginalDom, appScriptExecutedInReplay, differences }) => ({
    file,
    events,
    matchesOriginalDom,
    appScriptExecutedInReplay,
    differences: differences.join("; "),
  })),
);
if (results.some((r) => !r.matchesOriginalDom || r.appScriptExecutedInReplay)) process.exitCode = 1;
