// Shared page-view state for the page-scoped recipes (page views, exits, scroll depth,
// time on page). Not a recipe by itself.
//
// A page view starts on the first subscription ("initial") and whenever the URL path or
// query string changes through history.pushState ("push"), history.replaceState
// ("replace"), back/forward ("pop"), or a back/forward cache restore ("pop"). Changes
// that keep path and query (same URL, hash-only changes, state-only updates) do not
// start a new page view. The query string only distinguishes page views in memory; it
// is never sent (the SDK strips non-allowlisted query parameters from page_url).

export type Navigation = "initial" | "push" | "replace" | "pop";

export type PageView = {
  /** Random ID that links every page-scoped event of one page view. */
  id: string;
  /** location.pathname when the page view started. */
  path: string;
  navigation: Navigation;
  /** performance.now() when the page view started. */
  startedAt: number;
};

type Listener = (next: PageView, previous: PageView) => void;

const listeners = new Set<Listener>();
let current: PageView | undefined;
let currentKey = "";
let originalPush: History["pushState"] | undefined;
let originalReplace: History["replaceState"] | undefined;
let patchedPush: History["pushState"] | undefined;
let patchedReplace: History["replaceState"] | undefined;

function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const keyOf = () => location.pathname + location.search;

function start(navigation: Navigation): PageView {
  currentKey = keyOf();
  current = { id: randomId(), path: location.pathname, navigation, startedAt: performance.now() };
  return current;
}

function changed(navigation: Navigation, force = false): void {
  if (!current || (!force && keyOf() === currentKey)) return;
  const previous = current;
  const next = start(navigation);
  for (const listener of [...listeners]) {
    try {
      listener(next, previous);
    } catch (error) {
      console.error("page view listener failed", error);
    }
  }
}

const onPopState = () => changed("pop");
const onPageShow = (event: PageTransitionEvent) => {
  // Restored from the back/forward cache: the earlier page view already ended on pagehide.
  if (event.persisted) changed("pop", true);
};

function install(): void {
  start("initial");
  originalPush = history.pushState;
  originalReplace = history.replaceState;
  const push = originalPush;
  const replace = originalReplace;
  patchedPush = function (this: History, ...args: Parameters<History["pushState"]>) {
    push.apply(this, args);
    changed("push");
  };
  patchedReplace = function (this: History, ...args: Parameters<History["replaceState"]>) {
    replace.apply(this, args);
    changed("replace");
  };
  history.pushState = patchedPush;
  history.replaceState = patchedReplace;
  window.addEventListener("popstate", onPopState);
  window.addEventListener("pageshow", onPageShow);
}

function uninstall(): void {
  // Only restore if nobody wrapped history after us; otherwise leave the chain intact.
  if (history.pushState === patchedPush && originalPush) history.pushState = originalPush;
  if (history.replaceState === patchedReplace && originalReplace) history.replaceState = originalReplace;
  window.removeEventListener("popstate", onPopState);
  window.removeEventListener("pageshow", onPageShow);
  current = undefined;
}

/** The active page view, or undefined when no recipe is subscribed. */
export function currentPageView(): PageView | undefined {
  return current;
}

/**
 * Subscribe to page-view changes. The first subscriber starts an "initial" page view for
 * the current URL; the last unsubscribe restores history and forgets the page view.
 */
export function onPageViewChange(listener: Listener): () => void {
  if (listeners.size === 0) install();
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener)) return;
    if (listeners.size === 0) uninstall();
  };
}

/**
 * Run `callback` when the page is being left: first hidden or pagehide. Events queued
 * here are sent by the SDK in a keepalive request while the page is hidden.
 */
export function onPageLeave(callback: (reason: "hidden" | "pagehide") => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "hidden") callback("hidden");
  };
  const onPageHide = () => callback("pagehide");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
  };
}
