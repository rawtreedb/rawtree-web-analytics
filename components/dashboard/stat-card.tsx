// Headline metric card with an optional comparison and a daily sparkline (Recharts).
"use client";

import type { ReactNode } from "react";
import { Area, AreaChart, YAxis } from "recharts";
import { formatValue, type ValueFormat } from "../../lib/format.ts";
import { InfoTip } from "../ui/info-tip.tsx";
import { cardClass, cn } from "../ui/styles.ts";
import { Tooltip as HoverTip } from "../ui/tooltip.tsx";
import { deltaTrigger, previousPeriodInfo } from "./chart-styles.ts";
import { chartColors } from "./colors.ts";
import { Delta } from "./delta.tsx";

/** Decorative daily trend for stat cards. */
function Sparkline({ values, color = chartColors.primary, label }: { values: readonly number[]; color?: string; label: string }) {
  return (
    <AreaChart
      accessibilityLayer={false}
      aria-label={label}
      data={values.map((value, index) => ({ index, value }))}
      margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
      responsive
      role="img"
      style={{ width: "100%", height: "100%" }}
    >
      <YAxis domain={[0, "dataMax"]} hide />
      <Area dataKey="value" dot={false} fill={color} fillOpacity={0.12} isAnimationActive={false} stroke={color} strokeWidth={1.6} type="monotone" />
    </AreaChart>
  );
}

/** Headline metric with an optional comparison and daily sparkline. */
export function StatCard({
  label,
  value,
  format = "number",
  change,
  changeKind = "relative",
  neutral = false,
  info,
  hint,
  trend,
  trendColor,
}: {
  label: string;
  value: number | null;
  format?: ValueFormat;
  /** Omit to hide the comparison row. */
  change?: number | null;
  changeKind?: "relative" | "points";
  neutral?: boolean;
  info?: string;
  hint?: ReactNode;
  trend?: readonly number[];
  trendColor?: string;
}) {
  return (
    <article
      className={cn(cardClass, "flex min-h-34 flex-col gap-1.5 px-4.5 py-4")}
      data-testid={`stat-${label.toLowerCase().replace(/ /g, "-")}`}
    >
      <header className="flex items-center gap-1">
        <h3 className="m-0 text-xs font-semibold text-muted-foreground">{label}</h3>
        {info ? <InfoTip>{info}</InfoTip> : null}
      </header>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="numeric m-0 whitespace-nowrap text-3xl font-semibold">{formatValue(value, format)}</p>
        {change !== undefined ? (
          <HoverTip className={cn(deltaTrigger, "text-xs")} content={previousPeriodInfo}>
            <Delta kind={changeKind} neutral={neutral} value={change} />
          </HoverTip>
        ) : null}
      </div>
      {hint ? <p className="m-0 text-xs text-muted-foreground">{hint}</p> : null}
      {trend && trend.length > 1 ? (
        <div className="pointer-events-none mt-auto h-14 pt-4">
          <Sparkline color={trendColor} label={`${label} by day`} values={trend} />
        </div>
      ) : null}
    </article>
  );
}
