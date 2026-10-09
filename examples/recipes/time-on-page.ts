// Recipe: time on page.
// Definition: for one page view, `visible_ms` is the time the document was visible
// (document.visibilityState === "visible"), and `elapsed_ms` is wall-clock time since
// the page view started. For the initial page view both start when tracking starts
// (after analytics consent), not at navigation start. "Visible" is not "active": an idle
// user staring at a visible tab still counts.
// One `time_on_page` is sent when the page view ends: on the next SPA navigation, or the
// first time the page is hidden or fires pagehide. Time spent after returning to a
// previously hidden tab is not reported for that page view (trade-off for sending once
// while the page is still alive).

import type { Analytics } from "@rawtree/analytics";
import { currentPageView, onPageLeave, onPageViewChange, type PageView } from "./navigation.ts";

export function trackTimeOnPage(analytics: Analytics): () => void {
  let visibleMs = 0;
  let visibleSince: number | undefined;
  let reportedFor: string | undefined;

  const resetFor = () => {
    visibleMs = 0;
    visibleSince = document.visibilityState === "visible" ? performance.now() : undefined;
  };

  function report(view: PageView | undefined): void {
    if (!view || reportedFor === view.id) return;
    reportedFor = view.id;
    const now = performance.now();
    if (visibleSince !== undefined) visibleMs += now - visibleSince;
    visibleSince = undefined;
    analytics.sendEvent("time_on_page", {
      page_view_id: view.id,
      path: view.path,
      visible_ms: Math.round(visibleMs),
      elapsed_ms: Math.round(now - view.startedAt),
    });
  }

  const unsubscribe = onPageViewChange((_next, previous) => {
    report(previous);
    resetFor();
  });
  resetFor();

  const stopLeave = onPageLeave(() => report(currentPageView()));
  const onVisible = () => {
    const view = currentPageView();
    if (document.visibilityState === "visible" && view && reportedFor !== view.id) visibleSince = performance.now();
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    stopLeave();
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
