import type { ReactNode } from "react";
import type { DashboardData, Totals } from "../../../lib/dashboard.ts";
import { formatValue, relativeChange } from "../../../lib/format.ts";
import { BarListCard } from "../../../components/dashboard/bar-list.tsx";
import { DashboardCard } from "../../../components/dashboard/card.tsx";
import { DonutChart } from "../../../components/dashboard/donut-chart.tsx";
import { DashboardGrid, GridItem } from "../../../components/dashboard/grid.tsx";
import { DashboardSection } from "../../../components/dashboard/section.tsx";

/** Paths grouped by their first segment ("/docs/a" → "/docs"). */
function siteSections(pages: DashboardData["current"]["topPages"]) {
  const counts = new Map<string, number>();
  for (const { path, pageViews } of pages) {
    const section = `/${path.split("/").filter(Boolean)[0] ?? ""}`;
    counts.set(section, (counts.get(section) ?? 0) + pageViews);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}

export function ContentSection({ data, now, scope }: { data: DashboardData; now: Totals; scope: ReactNode }) {
  const pages = data.current.topPages;
  const previous = new Map(data.previous.topPages.map((row) => [row.path, row.pageViews]));
  return (
    <DashboardSection badges={scope} description="Page views by path, compared with the previous period." id="content" title="Content">
      <DashboardGrid>
        <GridItem lg={8} md={7}>
          <BarListCard
            columns={{ label: "Path", details: ["Visitors"], value: "Views", share: "Share", change: "Change" }}
            empty="No page views in this range."
            info="Share is of all page views in the range. Change is against the same path in the previous period."
            items={pages.map((row) => ({
              label: row.path,
              value: row.pageViews,
              details: [formatValue(row.visitors)],
              change: relativeChange(row.pageViews, previous.get(row.path) ?? null),
            }))}
            limit={10}
            title="Top pages"
            total={now.pageViews}
          />
        </GridItem>
        <GridItem lg={4} md={5}>
          <DashboardCard description="Page views grouped by first path segment." title="Site sections">
            <DonutChart centerLabel="page views" items={siteSections(pages)} label="Page views by site section" />
          </DashboardCard>
        </GridItem>
      </DashboardGrid>
    </DashboardSection>
  );
}
