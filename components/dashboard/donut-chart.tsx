// Share-of-total donut with a legend (Recharts).
"use client";

import { Pie, PieChart, Tooltip } from "recharts";
import { formatValue } from "../../lib/format.ts";
import { CardEmpty } from "./card.tsx";
import { tooltipClass } from "./chart-styles.ts";
import { ChartSwatch } from "./chart-swatch.tsx";
import { categoricalColors } from "./colors.ts";

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
          <li className="flex items-center gap-2" key={slice.label}>
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
