// Daily metric chart card (Recharts): metric switcher, headline total with change, legend,
// and a comparison toggle for the previous period.
"use client";

import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { formatDay, formatLongDay, formatValue, relativeChange } from "../../lib/format.ts";
import { SegmentedControl } from "../ui/segmented-control.tsx";
import { Tooltip as HoverTip } from "../ui/tooltip.tsx";
import { DashboardCard } from "./card.tsx";
import { deltaTrigger, previousPeriodInfo, tooltipClass } from "./chart-styles.ts";
import { ChartSwatch } from "./chart-swatch.tsx";
import { Delta } from "./delta.tsx";

// Axis labels at the --text-2xs size (11px); Recharts takes a number.
const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

export type ChartRow = Record<string, string | number | null>;
type ChartSeries = { key: string; label: string; color: string; comparisonKey?: string };

/** Daily series over UTC days with dashed previous-period lines. Rows carry `day` and `previousDay`. */
function TimeSeriesChart({
  data,
  series,
  showComparison,
  label,
}: {
  data: readonly ChartRow[];
  series: readonly ChartSeries[];
  showComparison: boolean;
  label: string;
}) {
  return (
    <div className="h-65 [&_.recharts-cartesian-axis-tick-value]:font-mono [&_.recharts-cartesian-axis-tick-value]:tracking-tight [&_:focus:not(:focus-visible)]:outline-none">
      <ComposedChart aria-label={label} data={[...data]} margin={{ top: 16, right: 24, bottom: 0, left: 0 }} responsive style={{ width: "100%", height: "100%" }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="day"
          minTickGap={28}
          tick={axisTick}
          tickFormatter={(value: string) => formatDay(value)}
          tickLine={false}
          tickMargin={8}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tick={axisTick}
          tickFormatter={(value: number) => formatValue(value, "compact")}
          tickLine={false}
          width="auto"
        />
        <Tooltip
          content={({ active, label: day }) => {
            if (!active || typeof day !== "string") return null;
            const row = data.find((candidate) => candidate.day === day);
            if (!row) return null;
            return (
              <div className={tooltipClass}>
                <p className="mb-1.5 font-semibold">{formatLongDay(day)}</p>
                <dl className="m-0 grid gap-1">
                  {series.map((item) => (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5" key={item.key}>
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <ChartSwatch color={item.color} />
                        {item.label}
                      </dt>
                      <dd className="numeric m-0 text-right font-semibold">{formatValue(Number(row[item.key] ?? 0))}</dd>
                      {showComparison && item.comparisonKey ? (
                        <>
                          <dt className="flex items-center gap-1.5 text-muted-foreground">
                            <ChartSwatch color={item.color} variant="dashed" />
                            {typeof row.previousDay === "string" ? formatDay(row.previousDay) : "Previous"}
                          </dt>
                          <dd className="numeric m-0 text-right font-medium text-muted-foreground">
                            {formatValue(Number(row[item.comparisonKey] ?? 0))}
                          </dd>
                        </>
                      ) : null}
                    </div>
                  ))}
                </dl>
              </div>
            );
          }}
          cursor={{ stroke: "var(--high-contrast-border)", strokeWidth: 1 }}
          isAnimationActive={false}
        />
        {series.map((item) => (
          <Area
            activeDot={{ r: 4, strokeWidth: 0 }}
            dataKey={item.key}
            dot={data.length === 1}
            fill={item.color}
            fillOpacity={0.12}
            isAnimationActive={false}
            key={item.key}
            name={item.label}
            stroke={item.color}
            strokeWidth={2}
            type="monotone"
          />
        ))}
        {showComparison
          ? series
              .filter((item) => item.comparisonKey)
              .map((item) => (
                <Line
                  activeDot={false}
                  dataKey={item.comparisonKey}
                  dot={false}
                  isAnimationActive={false}
                  key={`cmp-${item.key}`}
                  name={`${item.label} (previous)`}
                  stroke={item.color}
                  strokeDasharray="5 4"
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                  type="monotone"
                />
              ))
          : null}
      </ComposedChart>
    </div>
  );
}

type ChartMetric = {
  id: string;
  label: string;
  series: readonly ChartSeries[];
  total?: number | null;
  previousTotal?: number | null;
  neutral?: boolean;
  description?: string;
};

/** Card around a daily chart: metric switcher, headline total with change, legend, comparison toggle. */
export function MetricChartCard({
  title,
  info,
  metrics,
  data,
}: {
  title: string;
  info?: string;
  metrics: readonly ChartMetric[];
  data: readonly ChartRow[];
}) {
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? "");
  const [compare, setCompare] = useState(true);
  const metric = metrics.find(({ id }) => id === metricId) ?? metrics[0];
  if (!metric) return null;
  const hasComparison = metric.series.some((item) => item.comparisonKey);

  return (
    <DashboardCard
      action={
        metrics.length > 1 ? (
          <SegmentedControl items={metrics.map(({ id, label }) => ({ value: id, label }))} label={`${title} metric`} onValueChange={setMetricId} value={metric.id} />
        ) : undefined
      }
      info={info}
      title={title}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        {metric.total !== undefined ? (
          <div className="flex flex-wrap items-baseline gap-1.5 text-xs text-muted-foreground">
            <strong className="numeric text-2xl font-semibold text-foreground">{formatValue(metric.total)}</strong>
            {metric.previousTotal !== undefined ? (
              <>
                <HoverTip className={deltaTrigger} content={previousPeriodInfo}>
                  <Delta neutral={metric.neutral} value={relativeChange(metric.total ?? null, metric.previousTotal)} />
                </HoverTip>
              </>
            ) : null}
          </div>
        ) : null}
        <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0 text-xs text-muted-foreground">
          {metric.series.map((item) => (
            <li className="inline-flex items-center gap-1.5" key={item.key}>
              <ChartSwatch color={item.color} />
              {item.label}
            </li>
          ))}
          {hasComparison && compare ? (
            <li className="inline-flex items-center gap-1.5">
              <ChartSwatch color="var(--muted-foreground)" variant="dashed" />
              Previous period
            </li>
          ) : null}
          {hasComparison ? (
            <li>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input checked={compare} className="accent-primary" onChange={(event) => setCompare(event.target.checked)} type="checkbox" />
                Compare
              </label>
            </li>
          ) : null}
        </ul>
      </div>
      {metric.description ? <p className="-mt-1 mb-3 text-xs leading-normal text-muted-foreground">{metric.description}</p> : null}
      <TimeSeriesChart data={data} label={`${title}: ${metric.label} by UTC day`} series={metric.series} showComparison={compare} />
    </DashboardCard>
  );
}
