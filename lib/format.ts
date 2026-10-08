// Small formatting helpers shared by the dashboard pages. Dates render in a fixed
// time zone so server-rendered output is stable.

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatDateTime(ms: number): string {
  return dateTime.format(new Date(ms));
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
}

// Dashboard value formats, ported from Treewatcher (lib/format.ts).
export type ValueFormat = "number" | "compact" | "percent" | "decimal" | "ratio" | "duration";

const formatters = {
  number: new Intl.NumberFormat("en"),
  compact: new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }),
  percent: new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 }),
  decimal: new Intl.NumberFormat("en", { maximumFractionDigits: 2 }),
};

export function formatValue(value: number | null | undefined, format: ValueFormat = "number"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  if (format === "ratio") return `1 : ${formatters.decimal.format(value)}`;
  if (format === "duration") return formatDuration(value);
  return formatters[format].format(value);
}

/** Relative change as a fraction, or null when there is no prior baseline. */
export function relativeChange(current: number | null, previous: number | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / previous;
}

/** Safe ratio: null when the denominator is zero. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

const dayFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const longDayFormat = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Oct 5" for a `YYYY-MM-DD` UTC day. */
export function formatDay(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

/** "Mon, Oct 5, 2026" for a `YYYY-MM-DD` UTC day. */
export function formatLongDay(day: string): string {
  return longDayFormat.format(new Date(`${day}T00:00:00Z`));
}
