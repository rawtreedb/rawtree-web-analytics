"use client";

import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { formatDay } from "../../lib/format.ts";
import { cn } from "../ui.tsx";
import { Button } from "./button.tsx";
import { Calendar } from "./calendar.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";

/** Inclusive UTC day range as `YYYY-MM-DD` strings. */
export type DayRange = { from: string; to: string };

const DAY = 86_400_000;

function toDate(day: string) {
  return new Date(`${day}T00:00:00Z`);
}

function toDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString().slice(0, 10);
}

function dayCount(range: DayRange) {
  return Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY) + 1;
}

function rangeLabel(range: DayRange) {
  const year = (day: string) => day.slice(0, 4);
  if (range.from === range.to) return `${formatDay(range.from)}, ${year(range.from)}`;
  const from = year(range.from) === year(range.to) ? formatDay(range.from) : `${formatDay(range.from)}, ${year(range.from)}`;
  return `${from} – ${formatDay(range.to)}, ${year(range.to)}`;
}

const sectionLabel = "eyebrow mb-1.5 px-2";

/**
 * Presets on the left, a two-month UTC calendar for custom ranges on the right.
 * Selection is applied explicitly so partial ranges never trigger a reload.
 */
export function DateRangePicker({
  presets,
  activePreset,
  range,
  label,
  maxDay,
  maxDays,
  pending = false,
  onPreset,
  onRange,
}: {
  presets: readonly { value: string; label: string }[];
  /** Null when a custom range is applied. */
  activePreset: string | null;
  /** The applied range, used to seed the calendar. */
  range: DayRange;
  /** Trigger text. */
  label: string;
  /** Last selectable UTC day. */
  maxDay: string;
  maxDays: number;
  pending?: boolean;
  onPreset: (value: string) => void;
  onRange: (range: DayRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  // The applied range is shown when opening; the first click starts a new selection.
  const [fresh, setFresh] = useState(true);
  const selected = draft?.from && draft.to ? { from: toDay(draft.from), to: toDay(draft.to) } : null;
  const tooLong = selected !== null && dayCount(selected) > maxDays;
  const lastMonth = toDate(range.to);
  const firstVisible = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() - 1, 1));

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft({ from: toDate(range.from), to: toDate(range.to) });
      setFresh(true);
    }
  };

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger
        aria-label={`Reporting window: ${label}`}
        data-pending={pending || undefined}
        data-slot="date-range-trigger"
        render={
          <Button
            className="group/range h-10 min-w-60 justify-start gap-2 bg-card pr-3 pl-3.5 font-semibold text-sm shadow-soft hover:border-high-contrast-border hover:bg-card aria-expanded:border-high-contrast-border aria-expanded:bg-card max-md:min-w-0"
            variant="outline"
          />
        }
      >
        <svg
          aria-hidden="true"
          className="text-muted-foreground group-data-pending/range:animate-pulse group-data-pending/range:text-primary"
          fill="none"
          viewBox="0 0 16 16"
        >
          <rect height="10" rx="2" stroke="currentColor" strokeWidth="1.3" width="11" x="2.5" y="3.5" />
          <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
        </svg>
        <span className="flex-1 truncate text-left">{label}</span>
        <span className="rounded-full bg-muted px-1.5 py-px font-mono font-semibold text-2xs text-muted-foreground">UTC</span>
        <svg aria-hidden="true" className="text-muted-foreground" fill="none" viewBox="0 0 16 16">
          <path d="m4.5 6.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
        </svg>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto max-w-(--available-width) gap-0 overflow-hidden p-0 shadow-popover ring-foreground/10"
        sideOffset={8}
      >
        <div className="flex max-md:max-h-(--available-height) max-md:flex-col max-md:overflow-auto" data-slot="date-range-picker">
          <nav
            aria-label="Preset windows"
            className="grid min-w-40 content-start gap-0.5 border-r px-2 py-3 max-md:flex max-md:flex-wrap max-md:border-r-0 max-md:border-b"
          >
            <p className={cn(sectionLabel, "max-md:w-full")}>Presets</p>
            {presets.map((preset) => (
              <button
                aria-current={preset.value === activePreset ? "true" : undefined}
                className="cursor-pointer whitespace-nowrap rounded-md px-2.5 py-2 text-left font-medium text-foreground text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=true]:bg-primary/10 aria-[current=true]:font-semibold aria-[current=true]:text-primary"
                key={preset.value}
                onClick={() => {
                  setOpen(false);
                  onPreset(preset.value);
                }}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </nav>
          <div className="px-4 pt-3 pb-3.5" data-slot="date-range-calendar">
            <p className={sectionLabel}>Custom range (UTC days)</p>
            <Calendar
              className="p-0 cell-size-9"
              defaultMonth={firstVisible}
              disabled={{ after: toDate(maxDay) }}
              endMonth={toDate(maxDay)}
              mode="range"
              numberOfMonths={2}
              onSelect={(next, day) => {
                setDraft(fresh ? { from: day, to: undefined } : next);
                setFresh(false);
              }}
              selected={draft}
              showOutsideDays={false}
              timeZone="UTC"
              weekStartsOn={1}
            />
            <footer className="mt-2 flex items-center gap-1.5 border-t pt-3">
              <span className={cn("flex-1 text-muted-foreground text-xs", tooLong && "text-destructive")}>
                {selected
                  ? tooLong
                    ? `Ranges are limited to ${maxDays} days`
                    : `${rangeLabel(selected)} · ${dayCount(selected)} ${dayCount(selected) === 1 ? "day" : "days"}`
                  : draft?.from
                    ? "Select an end day"
                    : "Select a start day"}
              </span>
              <Button onClick={() => setOpen(false)} size="sm" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={!selected || tooLong}
                onClick={() => {
                  if (!selected) return;
                  setOpen(false);
                  onRange(selected);
                }}
                size="sm"
              >
                Apply
              </Button>
            </footer>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { rangeLabel as formatDayRange };
