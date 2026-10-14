import type { CSSProperties } from "react";
import { formatValue, type ValueFormat } from "../../lib/format.ts";
import { CardEmpty, DashboardCard } from "./card.tsx";
import { ChartSwatch } from "./chart-swatch.tsx";
import { Delta } from "./delta.tsx";

type BarListItem = {
  label: string;
  value: number;
  /** Extra preformatted columns shown before the value; `color` adds a matching swatch. */
  details?: readonly (string | { label: string; color: string })[];
  color?: string;
  /** Relative change versus the previous period. */
  change?: number | null;
};

type BarListColumns = { label: string; value: string; details?: readonly string[]; change?: string; share?: string };

const headCell = "eyebrow whitespace-nowrap px-2.5 pb-0.5 text-right first:text-left";
const numericCell = "numeric whitespace-nowrap px-2.5 py-2 text-right text-xs last:rounded-r-md last:font-semibold";

/** Ranked rows with a background bar proportional to the largest value, plus share and change columns. */
function BarList({
  items,
  columns,
  format = "number",
  total,
  color,
  caption,
}: {
  items: readonly BarListItem[];
  columns: BarListColumns;
  format?: ValueFormat;
  /** Denominator for the share column; defaults to the sum of `items`. */
  total?: number;
  color?: string;
  caption?: string;
}) {
  const max = Math.max(0, ...items.map((item) => Math.abs(item.value)));
  const sum = total ?? items.reduce((acc, item) => acc + item.value, 0);
  return (
    <table
      className="w-full table-auto border-separate border-spacing-x-0 border-spacing-y-1 text-xs"
      style={{ "--bar-color": color ?? "var(--primary)" } as CSSProperties}
    >
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <thead>
        <tr>
          <th className={headCell} scope="col">{columns.label}</th>
          {columns.details?.map((header) => (
            <th className={headCell} key={header} scope="col">{header}</th>
          ))}
          <th className={headCell} scope="col">{columns.value}</th>
          {columns.share ? <th className={headCell} scope="col">{columns.share}</th> : null}
          {columns.change ? <th className={headCell} scope="col">{columns.change}</th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            // The bar is a hard gradient stop at --bar, tinted with the row or list color.
            className="bg-linear-to-r from-(--bar-color)/10 from-(percentage:--bar) to-transparent to-(percentage:--bar) hover:bg-muted"
            key={[item.label, ...(item.details ?? []).map((detail) => (typeof detail === "string" ? detail : detail.label))].join("\u0000")}
            style={{ "--bar": `${max === 0 ? 0 : (Math.abs(item.value) / max) * 100}%`, ...(item.color ? { "--bar-color": item.color } : {}) } as CSSProperties}
          >
            <th className="w-full max-w-0 truncate rounded-l-md px-2.5 py-2 text-left font-medium" scope="row" title={item.label}>
              {item.label}
            </th>
            {item.details?.map((detail, index) => (
              <td className={numericCell} key={columns.details?.[index] ?? index}>
                {typeof detail === "string" ? (
                  detail
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <ChartSwatch color={detail.color} />
                    {detail.label}
                  </span>
                )}
              </td>
            ))}
            <td className={numericCell}>{formatValue(item.value, format)}</td>
            {columns.share ? <td className={numericCell}>{formatValue(item.value / sum, "percent")}</td> : null}
            {columns.change ? (
              <td className={numericCell}>
                <Delta emptyLabel="–" value={item.change ?? null} />
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Card with one ranked breakdown, showing the top `limit` rows. */
export function BarListCard({
  title,
  info,
  items,
  columns,
  format,
  total,
  color,
  empty = "No rows in this range.",
  limit = 8,
}: {
  title: string;
  info?: string;
  items: readonly BarListItem[];
  columns: BarListColumns;
  format?: ValueFormat;
  total?: number;
  color?: string;
  empty?: string;
  limit?: number;
}) {
  return (
    <DashboardCard
      footer={items.length > limit ? <span>Showing {limit} of {items.length}</span> : undefined}
      info={info}
      title={title}
    >
      {items.length ? (
        <BarList caption={title} color={color} columns={columns} format={format} items={items.slice(0, limit)} total={total} />
      ) : (
        <CardEmpty>{empty}</CardEmpty>
      )}
    </DashboardCard>
  );
}
