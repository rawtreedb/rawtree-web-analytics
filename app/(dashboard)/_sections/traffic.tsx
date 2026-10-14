import type { ReactNode } from "react";
import type { Totals } from "../../../lib/dashboard.ts";
import { chartColors } from "../../../components/dashboard/colors.ts";
import { DataTableCard } from "../../../components/dashboard/data-table-card.tsx";
import { DashboardGrid, GridItem } from "../../../components/dashboard/grid.tsx";
import { MetricChartCard, type ChartRow } from "../../../components/dashboard/metric-chart-card.tsx";
import { DashboardSection } from "../../../components/dashboard/section.tsx";

export function TrafficSection({ now, before, rows, scope, hasAgents }: { now: Totals; before: Totals; rows: ChartRow[]; scope: ReactNode; hasAgents: boolean }) {
  return (
    <DashboardSection
      badges={scope}
      description="Daily traffic per UTC day with the previous period as a dashed line."
      id="traffic"
      title="Traffic"
    >
      <DashboardGrid>
        <GridItem lg={8}>
          <MetricChartCard
            data={rows}
            info="Days are UTC. Day N of the range is compared with day N of the previous period."
            metrics={[
              { id: "pageViews", label: "Page views", total: now.pageViews, previousTotal: before.pageViews, series: [{ key: "pageViews", label: "Page views", color: chartColors.primary, comparisonKey: "previousPageViews" }] },
              { id: "sessions", label: "Sessions", total: now.sessions, previousTotal: before.sessions, series: [{ key: "sessions", label: "Sessions", color: chartColors.primary, comparisonKey: "previousSessions" }] },
              {
                id: "visitors",
                label: "Visitors",
                total: now.visitors,
                previousTotal: before.visitors,
                description: "The total counts each visitor once across the range, so it can be lower than the sum of the daily line.",
                series: [{ key: "visitors", label: "Daily visitors", color: chartColors.info, comparisonKey: "previousVisitors" }],
              },
              { id: "events", label: "Events", total: now.events, previousTotal: before.events, series: [{ key: "events", label: "Events", color: chartColors.info, comparisonKey: "previousEvents" }] },
            ]}
            title="Traffic trend"
          />
        </GridItem>
        <GridItem lg={4}>
          <DataTableCard
            columns={[
              { key: "day", header: "Day", format: "day" },
              { key: "pageViews", header: "Views" },
              { key: "sessions", header: "Sessions" },
              { key: "visitors", header: "Visitors" },
              { key: "events", header: "Events" },
              ...(hasAgents ? [{ key: "botEvents", header: "Bot events" }] : []),
            ]}
            description="Per UTC day. Daily visitors are not additive across days."
            initialSort={{ key: "day", direction: "desc" }}
            rows={rows}
            title="Daily breakdown"
            totals={{ day: "Range", pageViews: now.pageViews, sessions: now.sessions, visitors: now.visitors, events: now.events, botEvents: hasAgents ? now.botEvents : 0 }}
          />
        </GridItem>
      </DashboardGrid>
    </DashboardSection>
  );
}
