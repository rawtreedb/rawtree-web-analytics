import { cn } from "../ui/styles.ts";

const deltaPercent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const deltaPoints = new Intl.NumberFormat("en", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const deltaBase = "numeric inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-semibold text-muted-foreground";

/**
 * Change versus the previous period. `relative` expects a fraction such as 0.12;
 * `points` expects a difference between two rates such as 0.012 (shown as +1.2 pts).
 */
export function Delta({
  value,
  kind = "relative",
  neutral = false,
  emptyLabel = "No baseline",
}: {
  value: number | null;
  kind?: "relative" | "points";
  neutral?: boolean;
  emptyLabel?: string;
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={cn(deltaBase, "font-medium")}>{emptyLabel}</span>;
  }
  const trend = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const sentiment = trend === "flat" || neutral ? "neutral" : trend === "up" ? "positive" : "negative";
  return (
    <span className={cn(deltaBase, sentiment === "positive" && "text-success", sentiment === "negative" && "text-destructive")} data-trend={trend}>
      <span aria-hidden="true" className="text-2xs leading-none">
        {trend === "up" ? "▲" : trend === "down" ? "▼" : "–"}
      </span>
      {kind === "points" ? `${deltaPoints.format(value * 100)} pts` : deltaPercent.format(value)}
    </span>
  );
}
