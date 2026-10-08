// Recipe: scroll depth.
// Depth = (scrollY + viewport height) / document height, as a percentage, tracked as the
// maximum reached during the page view. Each threshold (25, 50, 75, 100) is sent once
// per page view as `scroll_depth { threshold, scrollable }`. A page with nothing to
// scroll sends only `threshold: 100, scrollable: false`, once. Height changes (lazy
// content, accordions) are re-measured with a ResizeObserver; a shrinking page can
// unlock the remaining thresholds. State resets on every new page view.
// Analyze with the maximum threshold per page_view_id rather than counting rows.

import type { Analytics } from "@rawtree/analytics";
import { currentPageView, onPageViewChange } from "./navigation.ts";

const THRESHOLDS = [25, 50, 75, 100] as const;

export function trackScrollDepth(analytics: Analytics): () => void {
  let reported = new Set<number>();
  let maxDepth = 0;
  let frame = 0;

  function measure(): void {
    frame = 0;
    const view = currentPageView();
    if (!view) return;
    const root = document.documentElement;
    const height = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
    const viewport = window.innerHeight;
    const scrollable = height - viewport > 1;
    const bottom = window.scrollY + viewport;
    const depth = !scrollable || bottom >= height - 2 ? 100 : (bottom / height) * 100;
    maxDepth = Math.max(maxDepth, depth);

    if (!scrollable && reported.size === 0) {
      for (const threshold of THRESHOLDS) reported.add(threshold);
      analytics.sendEvent("scroll_depth", { page_view_id: view.id, path: view.path, threshold: 100, scrollable: false });
      return;
    }
    for (const threshold of THRESHOLDS) {
      if (maxDepth < threshold || reported.has(threshold)) continue;
      reported.add(threshold);
      analytics.sendEvent("scroll_depth", { page_view_id: view.id, path: view.path, threshold, scrollable });
    }
  }

  // Coalesce scroll/resize bursts into one measurement per frame, after rendering.
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };

  const unsubscribe = onPageViewChange(() => {
    reported = new Set();
    maxDepth = 0;
    schedule();
  });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : undefined;
  observer?.observe(document.documentElement);
  if (document.body) observer?.observe(document.body);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  schedule();

  return () => {
    unsubscribe();
    observer?.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    if (frame) cancelAnimationFrame(frame);
  };
}
