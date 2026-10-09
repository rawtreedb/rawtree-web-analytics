// Dashboard date ranges: Treewatcher's presets or an explicit UTC window. Shared by the
// server page and the client date filter, so keep it free of server-only imports.

export const DAY_MS = 86_400_000;

/** Treewatcher's reporting-window presets, in picker order. */
export const RANGE_PRESETS = {
  today: "Today",
  this_week: "This week",
  last_week: "Last week",
  last_7_days: "Last 7 days",
  last_28_days: "Last 28 days",
  last_90_days: "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
} as const;

export type RangeKey = keyof typeof RANGE_PRESETS;

/** [fromMs, toMs) in epoch milliseconds. */
export type Range = { fromMs: number; toMs: number };

export type ResolvedRange = Range & {
  /** The preset used, or "custom" when explicit start/end timestamps were given. */
  key: RangeKey | "custom";
  label: string;
};

export type SearchParams = Record<string, string | string[] | undefined>;

/** The UTC day of a timestamp, as YYYY-MM-DD. */
export const toUtcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** [from, to) in ms for a preset. Weeks start on Monday; everything is UTC. */
function presetWindow(key: RangeKey, nowMs: number): [number, number] {
  const now = new Date(nowMs);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const week = today - ((now.getUTCDay() + 6) % 7) * DAY_MS;
  const month = (offset: number) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1);
  switch (key) {
    case "today": return [today, nowMs];
    case "this_week": return [week, nowMs];
    case "last_week": return [week - 7 * DAY_MS, week];
    // ponytail: "Last N days" runs through now (today included), unlike Treewatcher's full days,
    // so fresh analytics show up; switch to [today - N days, today) if full days matter more.
    case "last_7_days": return [today - 6 * DAY_MS, nowMs];
    case "last_28_days": return [today - 27 * DAY_MS, nowMs];
    case "last_90_days": return [today - 89 * DAY_MS, nowMs];
    case "this_month": return [month(0), nowMs];
    case "last_month": return [month(-1), month(0)];
  }
}

/**
 * Resolve the `range` preset, or `range=custom` with ISO `start`/`end` timestamps (`end`
 * exclusive, at most 366 days), from page search params. Falls back to the last 7 days.
 */
export function resolveRange(params: SearchParams, nowMs = Date.now()): ResolvedRange {
  const range = first(params.range);
  if (range === "custom") {
    const fromMs = Date.parse(first(params.start) ?? "");
    const toMs = Math.min(Date.parse(first(params.end) ?? ""), nowMs);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs && toMs - fromMs <= 366 * DAY_MS) {
      return { key: "custom", label: "Custom range", fromMs, toMs };
    }
  }
  const key = range && range in RANGE_PRESETS ? (range as RangeKey) : "last_7_days";
  const [fromMs, toMs] = presetWindow(key, nowMs);
  return { key, label: RANGE_PRESETS[key], fromMs, toMs };
}

/** The equal-length window immediately before the selected one. */
export function previousRange({ fromMs, toMs }: Range): Range {
  return { fromMs: fromMs - (toMs - fromMs), toMs: fromMs };
}
