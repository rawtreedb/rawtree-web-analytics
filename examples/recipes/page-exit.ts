// Recipe: page exits (best effort).
// One `page_exit` per page view, the first time the page becomes hidden or fires
// pagehide. SPA navigations do not send it: they end the page view without leaving the
// page (time-on-page covers that). Limits: mobile browsers may kill a hidden page
// without pagehide, a crash or forced quit sends nothing, the keepalive request can
// still fail, and a hidden tab that becomes visible again keeps the same page view, so
// "exit" really means "last moment we could reliably report".

import type { Analytics } from "@rawtree/analytics";
import { currentPageView, onPageLeave, onPageViewChange } from "./navigation.ts";

export function trackPageExits(analytics: Analytics): () => void {
  let reportedFor: string | undefined;
  // Subscribing keeps the shared page-view state alive while this recipe runs.
  const unsubscribe = onPageViewChange(() => {});
  const stopLeave = onPageLeave((reason) => {
    const view = currentPageView();
    if (!view || reportedFor === view.id) return;
    reportedFor = view.id;
    analytics.sendEvent("page_exit", { page_view_id: view.id, path: view.path, reason });
  });
  return () => {
    stopLeave();
    unsubscribe();
  };
}
