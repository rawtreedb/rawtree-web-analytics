// Card around a compact sortable table (local sort state).
"use client";

import { type ReactNode, useState } from "react";
import { formatDay, formatValue, type ValueFormat } from "../../lib/format.ts";
import { cn, focusRing } from "../ui/styles.ts";
import { CardEmpty, DashboardCard } from "./card.tsx";

type DataTableColumn = { key: string; header: string; format?: ValueFormat | "text" | "day" };
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
                    className={cn("eyebrow inline-flex w-full cursor-pointer items-center gap-1 px-3 py-2", focusRing, isNumeric(column) ? "justify-end" : "justify-start")}
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
