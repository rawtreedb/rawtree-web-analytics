// Server-safe dashboard primitives, trimmed from Treewatcher's components/ui (card,
// dashboard, delta, bar-list, page-toolbar, segmented-control) and styled with the
// rawtree-platform tokens. Each primitive bakes in its final classes; `cn` also resolves
// conflicting Tailwind utilities so overrides win (needed by the date picker's Button).
import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import type { CrawlerCategory } from "../lib/crawlers.ts";
import { twMerge } from "tailwind-merge";
import { formatValue, type ValueFormat } from "../lib/format.ts";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return twMerge(classes);
}

// --- Palette (CSS variables in app/globals.css, so charts follow the theme) ---------

export const chartColors = {
  primary: "var(--chart-primary)",
  comparison: "var(--chart-comparison)",
  success: "var(--chart-success)",
  info: "var(--chart-info)",
  muted: "var(--chart-muted)",
} as const;

export const categoricalColors = [
  "var(--chart-cat-1)",
  "var(--chart-cat-2)",
  "var(--chart-cat-3)",
  "var(--chart-cat-4)",
  "var(--chart-cat-5)",
  "var(--chart-cat-6)",
  "var(--chart-cat-7)",
] as const;

/** Fixed per crawler type so the donut and tables use the same color in every window. */
export const crawlerCategoryColors: Record<CrawlerCategory, string> = {
  "AI retrieval": "var(--chart-cat-1)",
  "AI training": "var(--chart-cat-6)",
  "Search indexer": "var(--chart-cat-2)",
  "Social preview": "var(--chart-cat-3)",
  "SEO tool": "var(--chart-cat-5)",
  "Script or headless": "var(--chart-cat-4)",
  Other: "var(--chart-muted)",
};

// --- Badge and card -------------------------------------------------------------

type BadgeVariant = "success" | "error" | "warning" | "info" | "purple" | "secondary";

const badgeVariants: Record<BadgeVariant, string> = {
  info: "bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)] border-[var(--badge-info-border)]",
  purple: "bg-[var(--badge-purple-bg)] text-[var(--badge-purple-fg)] border-[var(--badge-purple-border)]",
  warning: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-fg)] border-[var(--badge-warning-border)]",
  success: "bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)] border-[var(--badge-success-border)]",
  error: "bg-[var(--badge-error-bg)] text-[var(--badge-error-fg)] border-[var(--badge-error-border)]",
  secondary: "border-border bg-secondary text-muted-foreground",
};

export function Badge({ variant = "secondary", className, ...props }: ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn("inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-4xl border px-2 py-0.5 text-xs font-medium whitespace-nowrap", badgeVariants[variant], className)}
      {...props}
    />
  );
}

/** Small "i" marker whose explanation shows on hover (native title, no tooltip library). */
export function InfoTip({ children }: { children: string }) {
  return (
    <span
      className="inline-grid size-4.5 flex-none cursor-help place-items-center text-extra-muted-foreground hover:text-primary"
      title={children}
      aria-label={children}
      role="img"
    >
      <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 7.25v3.5M8 5.25h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

/** Dashboard card frame: title with optional info tip, description, header action, body, footer. */
export function DashboardCard({
  title,
  description,
  info,
  action,
  footer,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  info?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-card text-sm text-card-foreground shadow-soft ring-1 ring-foreground/10", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5 px-5 pt-4.5">
        <div className="min-w-0">
          <h3 className="mb-0.5 flex items-center gap-1.5 text-base font-semibold">
            {title}
            {info ? <InfoTip>{info}</InfoTip> : null}
          </h3>
          {description ? <p className="text-xs leading-normal text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-none items-center gap-2">{action}</div> : null}
      </div>
      <div className="min-w-0 flex-1 px-5 pt-4 pb-5">{children}</div>
      {footer ? <div className="flex items-center justify-between gap-4 border-t py-2 pr-3 pl-5 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

/** Dashed placeholder shown inside a card or section when it has nothing to show. */
export function CardEmpty({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("m-0 grid min-h-28 place-items-center rounded-lg border border-dashed p-4 text-center text-xs leading-normal text-muted-foreground", className)}
      data-slot="card-empty"
      {...props}
    />
  );
}

/** Error banner for failed queries. */
export function ErrorCard({ title = "Queries failed", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--badge-error-border)] bg-[var(--badge-error-bg)] px-5 py-4 text-sm">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </div>
  );
}

// --- Layout -----------------------------------------------------------------------

/** Titled dashboard section; its `id` is the anchor used by the sidebar. */
export function DashboardSection({
  id,
  title,
  description,
  badges,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    // scroll-mt clears the sticky page toolbar, including when its controls wrap.
    <section aria-labelledby={`${id}-title`} className="grid scroll-mt-36 gap-4" id={id}>
      <header>
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-lg font-semibold tracking-tight" id={`${id}-title`}>
            {title}
          </h2>
          {badges}
        </div>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** Twelve-column grid that responds to the dashboard `@container`, not the viewport. */
export function DashboardGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-12 gap-4", className)} {...props} />;
}

type Span = 4 | 5 | 6 | 7 | 8 | 12;

// Full class names so Tailwind can detect them.
const mdSpans: Record<Span, string> = {
  4: "@2xl:col-span-4",
  5: "@2xl:col-span-5",
  6: "@2xl:col-span-6",
  7: "@2xl:col-span-7",
  8: "@2xl:col-span-8",
  12: "@2xl:col-span-12",
};
const lgSpans: Record<Span, string> = {
  4: "@5xl:col-span-4",
  5: "@5xl:col-span-5",
  6: "@5xl:col-span-6",
  7: "@5xl:col-span-7",
  8: "@5xl:col-span-8",
  12: "@5xl:col-span-12",
};

const xlSpans: Record<Span, string> = {
  4: "@8xl:col-span-4",
  5: "@8xl:col-span-5",
  6: "@8xl:col-span-6",
  7: "@8xl:col-span-7",
  8: "@8xl:col-span-8",
  12: "@8xl:col-span-12",
};

/** Column spans per container width: md ≥ 42rem (@2xl), lg ≥ 64rem (@5xl), xl ≥ 100rem (@8xl). Full width below. */
export function GridItem({ md, lg, xl, className, ...props }: ComponentProps<"div"> & { md?: Span; lg?: Span; xl?: Span }) {
  return <div className={cn("col-span-12 min-w-0", md && mdSpans[md], lg && lgSpans[lg], xl && xlSpans[xl], className)} {...props} />;
}

/** Auto-filling row of stat cards; two columns on small screens. */
export function StatGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-stats gap-4 max-md:grid-cols-2 max-md:gap-3", className)} {...props} />;
}

/** Legend swatch: a filled square or a dashed comparison line. */
export function ChartSwatch({ color, variant = "solid" }: { color?: string; variant?: "solid" | "dashed" }) {
  const style: CSSProperties | undefined = variant === "dashed" ? { borderColor: color } : color ? { background: color } : undefined;
  return (
    <span
      className={cn("inline-block flex-none", variant === "dashed" ? "h-0 w-3.5 border-t-2 border-dashed" : "size-2.5 rounded-xs")}
      style={style}
    />
  );
}

// --- Delta and bar list --------------------------------------------------------------

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
  inverse = false,
  neutral = false,
  emptyLabel = "No baseline",
}: {
  value: number | null;
  kind?: "relative" | "points";
  inverse?: boolean;
  neutral?: boolean;
  emptyLabel?: string;
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={cn(deltaBase, "font-medium")}>{emptyLabel}</span>;
  }
  const trend = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const sentiment = trend === "flat" || neutral ? "neutral" : (trend === "up") !== inverse ? "positive" : "negative";
  return (
    <span className={cn(deltaBase, sentiment === "positive" && "text-success", sentiment === "negative" && "text-destructive")} data-trend={trend}>
      <span aria-hidden="true" className="text-2xs leading-none">
        {trend === "up" ? "▲" : trend === "down" ? "▼" : "–"}
      </span>
      {kind === "points" ? `${deltaPoints.format(value * 100)} pts` : deltaPercent.format(value)}
    </span>
  );
}

export type BarListItem = {
  label: string;
  value: number;
  /** Extra preformatted columns shown before the value; `color` adds a matching swatch. */
  details?: readonly (string | { label: string; color: string })[];
  color?: string;
  /** Relative change versus the previous period. */
  change?: number | null;
};

export type BarListColumns = { label: string; value: string; details?: readonly string[]; change?: string; share?: string };

const headCell = "eyebrow whitespace-nowrap px-2.5 pb-0.5 text-right first:text-left";
const numericCell = "numeric whitespace-nowrap px-2.5 py-2 text-right text-xs last:rounded-r-md last:font-semibold";

/** Ranked rows with a background bar proportional to the largest value, plus share and change columns. */
export function BarList({
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
            <th className="w-full max-w-0 truncate rounded-l-md px-2.5 py-2 text-left font-medium tabular-nums" scope="row" title={item.label}>
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
  description,
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
  description?: ReactNode;
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
      description={description}
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

// --- Page toolbar ---------------------------------------------------------------------

const segmentGroup = "no-scrollbar inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-muted p-0.5";
const segmentItem =
  "inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full border border-transparent px-3 text-xs font-semibold text-foreground/60 transition-colors hover:text-foreground data-active:border-border data-active:bg-background data-active:text-foreground data-active:shadow-soft";

/** Pill-shaped single-choice control for switching a view, metric, or playback option. */
export function SegmentedControl<T extends string>({
  label,
  items,
  value,
  onValueChange,
  itemClassName,
}: {
  label: string;
  items: readonly { value: T; label: string; title?: string }[];
  value: T;
  onValueChange: (value: T) => void;
  itemClassName?: string;
}) {
  return (
    <div aria-label={label} className={segmentGroup} role="radiogroup">
      {items.map((item) => (
        <button
          aria-checked={item.value === value}
          className={cn(segmentItem, itemClassName)}
          data-active={item.value === value || undefined}
          key={item.value}
          onClick={() => onValueChange(item.value)}
          role="radio"
          title={item.title}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Pill-shaped segmented control as links, for filters kept in the URL. */
export function SegmentedLinks({ label, items }: { label: string; items: readonly { href: string; label: string; active: boolean }[] }) {
  return (
    <nav aria-label={label} className={segmentGroup}>
      {items.map((item) => (
        <Link aria-current={item.active ? "page" : undefined} className={segmentItem} data-active={item.active || undefined} href={item.href} key={item.href} scroll={false}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Sticky page header with the title, meta line, and filters. It bleeds to the main
 * area's edges with negative margins that mirror the shell's `p-4 lg:p-6` padding.
 */
export function PageToolbar({
  title,
  badges,
  meta,
  filters,
  back,
}: {
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  filters?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="sticky top-0 z-20 -mx-4 -mt-4 mb-6 flex min-h-19 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b bg-background-extra/85 px-4 py-3 backdrop-blur-md backdrop-saturate-150 lg:-mx-6 lg:-mt-6 lg:px-6">
      <div className="grid min-w-0 grow basis-72 gap-1">
        {back ? (
          <Link className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary" href={back.href}>
            <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
              <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
            </svg>
            {back.label}
          </Link>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="m-0 min-w-0 truncate text-xl font-semibold tracking-tight">{title}</h1>
          {badges}
        </div>
        {meta ? <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {filters ? <div className="flex flex-wrap items-center gap-2 max-md:w-full">{filters}</div> : null}
    </header>
  );
}
