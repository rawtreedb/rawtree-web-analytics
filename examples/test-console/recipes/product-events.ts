// Recipe: product events defined by your product, not by the SDK.
// `project_created { project_id, template }` after the creation succeeded (not on the
// button click), and `feature_used { feature }` when a feature is actually used. Keep
// property values to IDs and small enums; never user-entered text such as project names.
// Outcomes that only the server can confirm (for example `export_completed`) belong in
// backend events instead (see backend-events.ts).

import type { Analytics } from "@rawtree/analytics";

/** Subscriptions your app provides for its outcomes; each returns an unsubscribe function. */
export type ProductSignals = {
  onProjectCreated(listener: (project: { projectId: string; template: string }) => void): () => void;
  onFeatureUsed(listener: (feature: string) => void): () => void;
};

export function trackProductEvents(analytics: Analytics, product: ProductSignals): () => void {
  const offs = [
    product.onProjectCreated(({ projectId, template }) =>
      analytics.sendEvent("project_created", { project_id: projectId, template }),
    ),
    product.onFeatureUsed((feature) => analytics.sendEvent("feature_used", { feature })),
  ];
  return () => offs.forEach((off) => off());
}
