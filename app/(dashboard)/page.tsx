// The dashboard: Overview, Traffic, Acquisition, Content, Engagement, and Bots for one
// date range, compared with the previous period of equal length. All SQL lives in
// lib/queries.ts (run by getDashboard); this page only shapes rows for display. Every count
// is deduplicated by ID in SQL.

import { requireAccess, signInAgainIfRejected } from "../../lib/access.ts";
import { getDashboard, queryErrorMessage, type DashboardData, type DayRow, type Totals } from "../../lib/dashboard.ts";
import { DAY_MS, previousRange, resolveRange, toUtcDay, type ResolvedRange, type SearchParams } from "../../lib/range.ts";
import { CardEmpty, ErrorCard } from "../../components/dashboard/card.tsx";
import { DateFilter } from "../../components/dashboard/date-filter.tsx";
import type { ChartRow } from "../../components/dashboard/metric-chart-card.tsx";
import { PageToolbar } from "../../components/dashboard/page-toolbar.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { AcquisitionSection } from "./_sections/acquisition.tsx";
import { BotsSection } from "./_sections/bots.tsx";
import { ContentSection } from "./_sections/content.tsx";
import { EngagementSection } from "./_sections/engagement.tsx";
import { OverviewSection } from "./_sections/overview.tsx";
import { TrafficSection } from "./_sections/traffic.tsx";

export const dynamic = "force-dynamic";

const instant = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const formatWindow = ({ fromMs, toMs }: { fromMs: number; toMs: number }) => `${instant.format(fromMs)} – ${instant.format(toMs)} UTC`;

/** Headline totals: humans only, or all traffic while no user agent is stored. */
function shownTotals(totals: Totals, hasUserAgent: boolean): Totals {
  if (hasUserAgent) return totals;
  return { ...totals, events: totals.allEvents, pageViews: totals.allPageViews, sessions: totals.allSessions, visitors: totals.allVisitors };
}

// --- Folding ------------------------------------------------------------------------

const DAILY_KEYS = ["pageViews", "sessions", "visitors", "events", "botEvents", "botPageViews"] as const;

/**
 * Continuous UTC days for the window, zero-filled, with day N of the previous period
 * on the same row (as previousPageViews, previousSessions, ...) so the dashed comparison line lines up.
 */
function dailyRows(range: ResolvedRange, current: DayRow[], previous: DayRow[]): ChartRow[] {
  const start = Math.floor(range.fromMs / DAY_MS) * DAY_MS;
  const previousStart = Math.floor(previousRange(range).fromMs / DAY_MS) * DAY_MS;
  const days = Math.max(1, Math.ceil((range.toMs - start) / DAY_MS));
  const currentByDay = new Map(current.map((row) => [row.dayMs, row]));
  const previousByDay = new Map(previous.map((row) => [row.dayMs, row]));
  return Array.from({ length: days }, (_, index) => {
    const now = currentByDay.get(start + index * DAY_MS);
    const before = previousByDay.get(previousStart + index * DAY_MS);
    const row: ChartRow = { day: toUtcDay(start + index * DAY_MS), previousDay: toUtcDay(previousStart + index * DAY_MS) };
    for (const key of DAILY_KEYS) {
      row[key] = now?.[key] ?? 0;
      row[`previous${key[0]!.toUpperCase()}${key.slice(1)}`] = before?.[key] ?? 0;
    }
    return row;
  });
}

// --- Header ---------------------------------------------------------------------------

function RangeFilter({ range }: { range: ResolvedRange }) {
  return (
    <DateFilter
      maxDay={toUtcDay(Date.now())}
      preset={range.key === "custom" ? null : range.key}
      range={{ from: toUtcDay(range.fromMs), to: toUtcDay(range.toMs - 1) }}
    />
  );
}

// --- Page -------------------------------------------------------------------------------

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const access = await requireAccess();
  const range = resolveRange(await searchParams);
  let data: DashboardData | null | undefined;
  let error: string | undefined;
  try {
    data = await getDashboard(range, access.query);
  } catch (caught) {
    signInAgainIfRejected(caught);
    error = queryErrorMessage(caught);
  }

  return (
    <div className="w-full">
      <PageToolbar
        filters={<RangeFilter range={range} />}
        meta={
          <>
            <strong className="font-semibold text-foreground" data-testid="range-label">
              {range.label}
            </strong>
            <span className="max-md:hidden">{formatWindow(range)}</span>
            <span className="max-md:hidden">vs {formatWindow(previousRange(range))}</span>
          </>
        }
        title="Dashboard"
      />
      {data ? (
        <Dashboard data={data} range={range} />
      ) : data === null ? (
        <CardEmpty>No events yet. Add the SDK to your app (or send some from the Console) and they will show up here.</CardEmpty>
      ) : (
        <ErrorCard>{error}</ErrorCard>
      )}
    </div>
  );
}

function Dashboard({ data, range }: { data: DashboardData; range: ResolvedRange }) {
  const rows = dailyRows(range, data.current.daily, data.previous.daily);
  const now = shownTotals(data.current.totals, data.hasUserAgent);
  const before = shownTotals(data.previous.totals, data.hasUserAgent);
  const hasAgents = data.hasUserAgent;
  const scope = hasAgents ? (
    <Badge variant="success">Humans only</Badge>
  ) : (
    <Badge title="No event has stored a user agent yet, so bots cannot be told apart." variant="warning">
      All traffic
    </Badge>
  );

  return (
    <div className="grid gap-9">
      <OverviewSection before={before} hasAgents={hasAgents} now={now} rows={rows} scope={scope} />
      <TrafficSection before={before} hasAgents={hasAgents} now={now} rows={rows} scope={scope} />
      <AcquisitionSection data={data} scope={scope} />
      <ContentSection data={data} now={now} scope={scope} />
      <EngagementSection data={data} scope={scope} />
      <BotsSection data={data} rows={rows} />
    </div>
  );
}
