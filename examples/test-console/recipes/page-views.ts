// Recipe: page views.
// One `page_view` for the initial page and one per client-side navigation that changes
// the path or query string. Re-pushing the same URL, replaceState to the same URL, and
// hash-only changes do not count. See navigation.ts for the exact page-view rules.

import type { Analytics } from "@rawtree/analytics";
import { currentPageView, onPageViewChange, type PageView } from "./navigation.ts";

export function trackPageViews(analytics: Analytics): () => void {
  const send = (view: PageView) =>
    analytics.sendEvent("page_view", { page_view_id: view.id, path: view.path, navigation: view.navigation });
  const unsubscribe = onPageViewChange((next) => send(next));
  const initial = currentPageView();
  if (initial) send(initial);
  return unsubscribe;
}
