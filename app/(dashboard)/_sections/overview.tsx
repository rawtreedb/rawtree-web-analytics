import type { ReactNode } from "react";
import type { Totals } from "../../../lib/dashboard.ts";
import { ratio, relativeChange } from "../../../lib/format.ts";
import { CardEmpty } from "../../../components/dashboard/card.tsx";
import { chartColors } from "../../../components/dashboard/colors.ts";
import { StatGrid } from "../../../components/dashboard/grid.tsx";
import type { ChartRow } from "../../../components/dashboard/metric-chart-card.tsx";
import { DashboardSection } from "../../../components/dashboard/section.tsx";
import { StatCard } from "../../../components/dashboard/stat-card.tsx";
import { pointChange } from "./point-change.ts";

const pagesPerSession = (totals: Totals) => ratio(totals.pageViews, totals.sessions);

export function OverviewSection({ now, before, rows, scope, hasAgents }: { now: Totals; before: Totals; rows: ChartRow[]; scope: ReactNode; hasAgents: boolean }) {
  const eventBotShare = (totals: Totals) => ratio(totals.botEvents, totals.allEvents);
  const noEvents = now.allEvents === 0;

  return (
    <DashboardSection
      badges={scope}
      description="Headline numbers for the selected range, compared with the previous period of the same length."
      id="overview"
      title="Overview"
    >
      <StatGrid>
        <StatCard
          change={relativeChange(now.sessions, before.sessions)}
          info="Distinct session IDs. One person can have several sessions."
          label="Sessions"
          trend={rows.map((row) => Number(row.sessions))}
          value={now.sessions}
        />
        <StatCard
          change={relativeChange(now.visitors, before.visitors)}
          info="Distinct anonymous IDs: approximates people. The same person on two devices counts twice."
          label="Visitors"
          trend={rows.map((row) => Number(row.visitors))}
          value={now.visitors}
        />
        <StatCard
          change={relativeChange(now.pageViews, before.pageViews)}
          info="Distinct page_view events."
          label="Page views"
          trend={rows.map((row) => Number(row.pageViews))}
          value={now.pageViews}
        />
        <StatCard
          change={relativeChange(pagesPerSession(now), pagesPerSession(before))}
          format="decimal"
          info="Page views divided by sessions."
          label="Pages per session"
          value={pagesPerSession(now)}
        />
        <StatCard
          change={relativeChange(now.events, before.events)}
          info="Distinct event IDs of every type. A resent event counts once."
          label="Events"
          trend={rows.map((row) => Number(row.events))}
          trendColor={chartColors.info}
          value={now.events}
        />
        {hasAgents ? (
          <StatCard
            change={pointChange(eventBotShare(now), eventBotShare(before))}
            changeKind="points"
            format="percent"
            info="Bot events as a share of all events."
            label="Bot share"
            neutral
            trend={rows.map((row) => ratio(Number(row.botEvents), Number(row.botEvents) + Number(row.events)) ?? 0)}
            trendColor={chartColors.muted}
            value={eventBotShare(now)}
          />
        ) : null}
      </StatGrid>
      {noEvents ? <CardEmpty>No events in this range. Send some from the Console, or widen the date range.</CardEmpty> : null}
    </DashboardSection>
  );
}
