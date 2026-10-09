// Recipe: Core Web Vitals with the standard `web-vitals` library.
// Each callback sends `web_vital { metric_name, metric_id, value, delta, rating,
// navigation_type }`. Units: milliseconds for LCP, INP, FCP, TTFB; CLS is unitless.
// One metric instance (metric_id) can be reported more than once as its value changes
// (CLS and INP grow; a bfcache restore creates new IDs), so analysis must keep the
// latest value per metric_id instead of counting rows. LCP, CLS, and INP are usually
// final when the page is hidden.
//
// web-vitals has no unsubscribe and must register only once per page, so the callbacks
// are registered once and forward to whichever analytics client is currently active.

import type { Analytics } from "@rawtree/analytics";
import { type MetricType, onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";

let sink: Analytics | undefined;
let registered = false;

function report(metric: MetricType): void {
  sink?.sendEvent("web_vital", {
    metric_name: metric.name,
    metric_id: metric.id,
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    navigation_type: metric.navigationType,
  });
}

export function trackWebVitals(analytics: Analytics): () => void {
  sink = analytics;
  if (!registered) {
    registered = true;
    onLCP(report);
    onCLS(report);
    onINP(report);
    onFCP(report);
    onTTFB(report);
  }
  return () => {
    if (sink === analytics) sink = undefined;
  };
}
