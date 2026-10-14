// Class names and copy shared by the chart cards (stat-card, donut-chart, metric-chart-card).
import { cn, focusRing } from "../ui/styles.ts";

export const previousPeriodInfo = "Change versus the previous period of the same length.";
// Dotted underline (a border, since text-decoration skips the inline-flex Delta) marks the change as hoverable.
// Lifted 6px so the underline, not the text baseline, lines up with the bottom of the number beside it
// (top, not translate: a transform would become the containing block of the fixed tooltip).
export const deltaTrigger = cn("relative -top-1.5 inline-flex cursor-help border-b border-dotted border-muted-foreground/60 pb-px hover:border-muted-foreground focus-visible:rounded-xs", focusRing);
export const tooltipClass = "min-w-44 max-w-72 rounded-lg border bg-card px-3 py-2.5 text-xs text-card-foreground shadow-popover";
