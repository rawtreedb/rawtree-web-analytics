// Interactive dashboard pieces (Recharts and tab state), trimmed from Treewatcher's
// components/charts and components/ui (stat-card, data-table, data-table-card,
// segmented-control). Annotations, dialogs, and tooltips-as-library are dropped.
"use client";

import { type ReactNode, useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatDay, formatLongDay, formatValue, relativeChange, type ValueFormat } from "../lib/format.ts";
import { Tooltip as HoverTip } from "./tooltip.tsx";
import { CardEmpty, ChartSwatch, DashboardCard, Delta, InfoTip, SegmentedControl, categoricalColors, chartColors, cn } from "./ui.tsx";

const previousPeriodInfo = "Change versus the previous period of the same length.";
// Dotted underline (a border, since text-decoration skips the inline-flex Delta) marks the change as hoverable.
const deltaTrigger = "inline-flex cursor-help border-b border-dotted border-muted-foreground/60 pb-px outline-none hover:border-muted-foreground focus-visible:rounded-xs focus-visible:ring-2 focus-visible:ring-ring";
const tooltipClass = "min-w-44 max-w-72 rounded-lg border bg-card px-3 py-2.5 text-xs text-card-foreground shadow-popover";

/** Decorative daily trend for stat cards. */
function Sparkline({ values, color = chartColors.primary, label }: { values: readonly number[]; color?: string; label: string }) {
  const gradient = `spark-${useId().replace(/:/g, "")}`;
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
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <YAxis domain={[0, "dataMax"]} hide />
      <Area dataKey="value" dot={false} fill={`url(#${gradient})`} isAnimationActive={false} stroke={color} strokeWidth={1.6} type="monotone" />
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
  inverse = false,
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
  inverse?: boolean;
  neutral?: boolean;
  info?: string;
  hint?: ReactNode;
  trend?: readonly number[];
  trendColor?: string;
}) {
  return (
    <article
      className={cn(
        "relative flex min-h-34 flex-col gap-1.5 rounded-2xl bg-card px-4.5 pt-4 text-card-foreground shadow-soft ring-1 ring-foreground/10",
        trend && trend.length > 1 ? "pb-11" : "pb-3.5",
      )}
      data-testid={`stat-${label.toLowerCase().replace(/ /g, "-")}`}
    >
      <header className="flex items-center gap-1">
        <h3 className="m-0 text-xs font-semibold text-muted-foreground">{label}</h3>
        {info ? <InfoTip>{info}</InfoTip> : null}
      </header>
      <p className="numeric relative z-1 m-0 text-3xl font-semibold">{formatValue(value, format)}</p>
      <div className="relative z-1 flex flex-1 flex-wrap content-start items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        {change !== undefined ? (
          <>
            <HoverTip className={deltaTrigger} content={previousPeriodInfo}>
              <Delta inverse={inverse} kind={changeKind} neutral={neutral} value={change} />
            </HoverTip>
          </>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </div>
      {trend && trend.length > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 overflow-hidden rounded-b-2xl opacity-85">
          <Sparkline color={trendColor} label={`${label} by day`} values={trend} />
        </div>
      ) : null}
    </article>
  );
}

/** Share-of-total donut with a legend. Slices beyond `maxSlices` are grouped as "Other". */
export function DonutChart({
  items,
  centerLabel,
  maxSlices = 6,
  label,
}: {
  /** `color` pins a slice's color; otherwise colors follow rank. */
  items: readonly { label: string; value: number; color?: string }[];
  centerLabel: string;
  maxSlices?: number;
  label: string;
}) {
  const sorted = [...items].filter(({ value }) => value > 0).sort((a, b) => b.value - a.value);
  const rest = sorted.slice(maxSlices).reduce((sum, item) => sum + item.value, 0);
  const slices: { label: string; value: number; color?: string }[] = rest > 0 ? [...sorted.slice(0, maxSlices), { label: "Other", value: rest }] : sorted.slice(0, maxSlices);
  const total = slices.reduce((sum, item) => sum + item.value, 0);
  const colored = slices.map((slice, index) => ({ ...slice, color: slice.color ?? categoricalColors[index % categoricalColors.length] }));
  if (total === 0) return <CardEmpty>Nothing to chart in this range.</CardEmpty>;

  return (
    <div className="flex min-h-full items-center justify-center gap-6 max-md:flex-col [&_:focus:not(:focus-visible)]:outline-none">
      <div className="relative aspect-square w-40 min-w-32 max-w-full shrink">
        <PieChart aria-label={label} responsive style={{ width: "100%", height: "100%" }}>
          <Pie
            cornerRadius={3}
            data={colored.map((slice) => ({ label: slice.label, value: slice.value, fill: slice.color }))}
            dataKey="value"
            innerRadius="68%"
            isAnimationActive={false}
            nameKey="label"
            outerRadius="100%"
            paddingAngle={slices.length > 1 ? 1.5 : 0}
            stroke="none"
          />
          <Tooltip
            content={({ active, payload }) => {
              const item = payload?.[0];
              if (!active || !item) return null;
              const value = Number(item.value ?? 0);
              return (
                <div className={tooltipClass}>
                  <p className="mb-1.5 font-semibold">{String(item.name)}</p>
                  <p className="numeric">
                    {formatValue(value)} · {formatValue(value / total, "percent")}
                  </p>
                </div>
              );
            }}
            isAnimationActive={false}
          />
        </PieChart>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <strong className="numeric text-2xl font-semibold">{formatValue(total, "compact")}</strong>
          <span className="text-2xs text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <ul className="m-0 grid w-full max-w-104 min-w-0 list-none gap-2 p-0 text-xs md:flex-1">
        {colored.map((slice) => (
          <li className="flex items-center gap-2 tabular-nums" key={slice.label}>
            <ChartSwatch color={slice.color} />
            <span className="min-w-0 flex-1 truncate" title={slice.label}>
              {slice.label}
            </span>
            <strong className="numeric font-semibold">{formatValue(slice.value)}</strong>
            <span className="numeric w-13 flex-none text-right text-muted-foreground">{formatValue(slice.value / total, "percent")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type ChartRow = Record<string, string | number | null>;
export type ChartSeries = { key: string; label: string; color: string; comparisonKey?: string };

/** Daily series over UTC days with dashed previous-period lines. Rows carry `day` and `previousDay`. */
function TimeSeriesChart({
  data,
  series,
  format = "number",
  showComparison,
  label,
}: {
  data: readonly ChartRow[];
  series: readonly ChartSeries[];
  format?: ValueFormat;
  showComparison: boolean;
  label: string;
}) {
  const gradientPrefix = `ts-${useId().replace(/:/g, "")}`;
  return (
    <div
      className="[&_.recharts-cartesian-axis-tick-value]:font-mono [&_.recharts-cartesian-axis-tick-value]:tracking-tight [&_:focus:not(:focus-visible)]:outline-none"
      style={{ height: 260 }}
    >
      <ComposedChart aria-label={label} data={[...data]} margin={{ top: 16, right: 24, bottom: 0, left: 0 }} responsive style={{ width: "100%", height: "100%" }}>
        <defs>
          {series.map((item) => (
            <linearGradient id={`${gradientPrefix}-${item.key}`} key={item.key} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity={0.24} />
              <stop offset="100%" stopColor={item.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="day"
          minTickGap={28}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickFormatter={(value: string) => formatDay(value)}
          tickLine={false}
          tickMargin={8}
        />
        <YAxis
          allowDecimals={format === "percent" || format === "decimal"}
          axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickFormatter={(value: number) => formatValue(value, format === "number" ? "compact" : format)}
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
                      <dd className="numeric m-0 text-right font-semibold">{formatValue(Number(row[item.key] ?? 0), format)}</dd>
                      {showComparison && item.comparisonKey ? (
                        <>
                          <dt className="flex items-center gap-1.5 text-extra-muted-foreground">
                            <ChartSwatch color={item.color} variant="dashed" />
                            {typeof row.previousDay === "string" ? formatDay(row.previousDay) : "Previous"}
                          </dt>
                          <dd className="numeric m-0 text-right font-medium text-extra-muted-foreground">
                            {formatValue(Number(row[item.comparisonKey] ?? 0), format)}
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
            fill={`url(#${gradientPrefix}-${item.key})`}
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

export type ChartMetric = {
  id: string;
  label: string;
  series: readonly ChartSeries[];
  total?: number | null;
  previousTotal?: number | null;
  format?: ValueFormat;
  neutral?: boolean;
  description?: string;
};

/** Card around a daily chart: metric switcher, headline total with change, legend, comparison toggle. */
export function MetricChartCard({
  title,
  description,
  info,
  metrics,
  data,
}: {
  title: string;
  description?: ReactNode;
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
      description={description}
      info={info}
      title={title}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        {metric.total !== undefined ? (
          <div className="flex flex-wrap items-baseline gap-1.5 text-xs text-muted-foreground">
            <strong className="numeric text-2xl font-semibold text-foreground">{formatValue(metric.total, metric.format)}</strong>
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
      <TimeSeriesChart data={data} format={metric.format} label={`${title}: ${metric.label} by UTC day`} series={metric.series} showComparison={compare} />
    </DashboardCard>
  );
}

export type DataTableColumn = { key: string; header: string; format?: ValueFormat | "text" | "day" };
type Cell = string | number | null;

function renderCell(value: Cell, format: DataTableColumn["format"] = typeof value === "number" ? "number" : "text") {
  if (value === null) return "–";
  if (format === "day" && typeof value === "string") return formatDay(value);
  if (typeof value === "number" && format !== "text" && format !== "day") return formatValue(value, format);
  return String(value);
}

const isNumeric = (column: DataTableColumn) => column.format !== "text" && column.format !== "day";

/** Compact sortable table with a sticky header, numeric alignment, and optional totals. */
function DataTable({
  caption,
  columns,
  rows,
  totals,
  initialSort,
}: {
  caption: string;
  columns: readonly DataTableColumn[];
  rows: readonly Record<string, Cell>[];
  totals?: Record<string, Cell>;
  initialSort?: { key: string; direction: "asc" | "desc" };
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const left = a[sort.key] ?? null;
        const right = b[sort.key] ?? null;
        if (left === right) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        const order = left < right ? -1 : 1;
        return sort.direction === "asc" ? order : -order;
      })
    : rows;
  const cellClass = (column: DataTableColumn) => cn("border-b px-3 py-2 text-xs", isNumeric(column) && "numeric text-right");

  return (
    <div className="max-h-92 overflow-auto rounded-lg border">
      <table className="w-full caption-bottom text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-1">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("border-b bg-muted p-0 whitespace-nowrap", isNumeric(column) && "text-right")}
                  key={column.key}
                  scope="col"
                >
                  <button
                    className={cn("eyebrow inline-flex w-full cursor-pointer items-center gap-1 px-3 py-2 text-muted-foreground", isNumeric(column) ? "justify-end" : "justify-start")}
                    onClick={() => setSort({ key: column.key, direction: active && sort.direction === "desc" ? "asc" : "desc" })}
                    type="button"
                  >
                    {column.header}
                    <span aria-hidden="true" className="text-extra-muted-foreground">
                      {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr className="hover:bg-primary/5" key={columns.map((column) => String(row[column.key] ?? "")).join("\u0000")}>
              {columns.map((column) => (
                <td className={cellClass(column)} key={column.key}>
                  {renderCell(row[column.key] ?? null, column.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals ? (
          <tfoot className="sticky bottom-0 bg-card font-semibold">
            <tr>
              {columns.map((column) => (
                <td className={cn(cellClass(column), "border-b-0 bg-card font-semibold")} key={column.key}>
                  {typeof totals[column.key] === "string" ? totals[column.key] : renderCell(totals[column.key] ?? null, column.format)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Card around a sortable table. */
export function DataTableCard({
  title,
  description,
  info,
  columns,
  rows,
  totals,
  initialSort,
  empty = "No rows in this range.",
}: {
  title: string;
  description?: ReactNode;
  info?: string;
  columns: readonly DataTableColumn[];
  rows: readonly Record<string, Cell>[];
  totals?: Record<string, Cell>;
  initialSort?: { key: string; direction: "asc" | "desc" };
  empty?: string;
}) {
  return (
    <DashboardCard description={description} info={info} title={title}>
      {rows.length ? <DataTable caption={title} columns={columns} initialSort={initialSort} rows={rows} totals={totals} /> : <CardEmpty>{empty}</CardEmpty>}
    </DashboardCard>
  );
}
