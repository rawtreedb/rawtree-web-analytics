// Shared browser helpers for the storage proof. Uses the system Chrome through
// playwright-core so no browser download is needed.

import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium, type Browser } from "playwright-core";

// rrweb's exports map hides the UMD bundle, so resolve files next to its main entry.
const RRWEB_DIST = dirname(createRequire(import.meta.url).resolve("rrweb"));
export const RRWEB_UMD_PATH = join(RRWEB_DIST, "rrweb.umd.min.cjs");
export const RRWEB_CSS_PATH = join(RRWEB_DIST, "style.css");
export const RRWEB_VERSION: string = JSON.parse(readFileSync(join(RRWEB_DIST, "../package.json"), "utf8")).version;

export const PROOF_DIR = new URL("../../.amp/in/", import.meta.url).pathname;
export const FIXTURE_DIR = `${PROOF_DIR}fixtures/`;
export const ARTIFACT_DIR = `${PROOF_DIR}artifacts/`;
mkdirSync(FIXTURE_DIR, { recursive: true });
mkdirSync(ARTIFACT_DIR, { recursive: true });

export function launchChrome(): Promise<Browser> {
  return chromium.launch({ channel: "chrome", headless: true });
}

/** Tag counts for body content, used to compare an original page with its replay. */
export type DomStats = { tags: Record<string, number>; textLength: number; scrollY: number; width: number };

export const COLLECT_DOM_STATS = `(() => {
  const doc = document;
  const tags = {};
  for (const el of doc.body.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "noscript") continue;
    // rrweb replaces blocked elements with an empty placeholder.
    if (el.parentElement?.closest(".rr-block")) continue;
    tags[tag] = (tags[tag] ?? 0) + 1;
  }
  const clone = doc.body.cloneNode(true);
  for (const el of clone.querySelectorAll("script, noscript, style, .rr-block *")) el.remove();
  const textLength = (clone.textContent ?? "").replace(/\\s+/g, "").length;
  return { tags, textLength, scrollY: Math.round(window.scrollY), width: window.innerWidth };
})()`;
