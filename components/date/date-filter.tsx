"use client";

// Reporting-window picker, ported from Treewatcher's GrowthDateFilter. The URL stays the
// single source of truth for the window (`range` preset, or `range=custom&start&end`).
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { DAY_MS, RANGE_PRESETS, type RangeKey } from "../../lib/range.ts";
import { type DayRange, DateRangePicker, formatDayRange } from "./date-range-picker.tsx";

const presets = Object.entries(RANGE_PRESETS).map(([value, label]) => ({ value, label }));

/** Next UTC midnight after `day`, capped at the current minute so windows never end in the future. */
function exclusiveEnd(day: string) {
  const next = Date.parse(`${day}T00:00:00Z`) + DAY_MS;
  const now = Date.now();
  return next <= now ? new Date(next).toISOString() : new Date(now - (now % 60_000)).toISOString();
}

export function DateFilter({ preset, range, maxDay }: { preset: RangeKey | null; range: DayRange; maxDay: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = (params: Record<string, string>) => startTransition(() => router.push(`/?${new URLSearchParams(params)}`, { scroll: false }));

  return (
    <DateRangePicker
      activePreset={preset}
      label={preset ? RANGE_PRESETS[preset] : formatDayRange(range)}
      maxDay={maxDay}
      maxDays={366}
      onPreset={(value) => navigate({ range: value })}
      onRange={(selected) => navigate({ range: "custom", start: `${selected.from}T00:00:00Z`, end: exclusiveEnd(selected.to) })}
      pending={pending}
      presets={presets}
      range={range}
    />
  );
}
