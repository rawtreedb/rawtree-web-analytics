// Recipe: CTA clicks.
// Mark call-to-action elements explicitly:
//   <a href="/signup" data-cta-id="pricing_start_trial" data-cta-placement="pricing_table">
// One delegated listener sends `cta_click { cta_id, placement }` per activation (mouse,
// touch, or keyboard Enter all dispatch click). It runs in the capture phase so it fires
// before the router navigates, which keeps page_url on the page where the click happened.
// Only the two data attributes are read: never element text, href, or form values.

import type { Analytics } from "@rawtree/analytics";

export function trackCtaClicks(analytics: Analytics, root: Document | HTMLElement = document): () => void {
  const onClick = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-cta-id]") : null;
    if (!target) return;
    const ctaId = target.dataset.ctaId;
    if (!ctaId) return;
    analytics.sendEvent("cta_click", { cta_id: ctaId, placement: target.dataset.ctaPlacement ?? "unknown" });
  };
  root.addEventListener("click", onClick, true);
  return () => root.removeEventListener("click", onClick, true);
}
