import type { ReactNode } from "react";
import { ENGAGED_MS, QUICK_EXIT_MS, type DashboardData } from "../../../lib/dashboard.ts";
import { ratio } from "../../../lib/format.ts";
import { BarListCard } from "../../../components/dashboard/bar-list.tsx";
import { CardEmpty } from "../../../components/dashboard/card.tsx";
import { chartColors } from "../../../components/dashboard/colors.ts";
import { DataTableCard } from "../../../components/dashboard/data-table-card.tsx";
import { DashboardGrid, GridItem, StatGrid } from "../../../components/dashboard/grid.tsx";
import { DashboardSection } from "../../../components/dashboard/section.tsx";
import { StatCard } from "../../../components/dashboard/stat-card.tsx";

export function EngagementSection({ data, scope }: { data: DashboardData; scope: ReactNode }) {
  const description = "Time on page and scroll depth per page view (deduplicated by page_view_id), plus CTA clicks.";
  const totals = data.timeTotals;
  const views = totals.views;
  const scrollViews = data.scrollTotals.views;
  if (views === 0 && scrollViews === 0 && data.ctas.length === 0) {
    return (
      <DashboardSection badges={scope} description={description} id="engagement" title="Engagement">
        <CardEmpty>No time_on_page, scroll_depth, or cta_click events in this range.</CardEmpty>
      </DashboardSection>
    );
  }
  const scrollByPath = new Map(data.scroll.map((row) => [row.path, row]));
  const paths = [...new Set([...data.timeOnPage.map((row) => row.path), ...data.scroll.map((row) => row.path)])];
  const timeByPath = new Map(data.timeOnPage.map((row) => [row.path, row]));

  return (
    <DashboardSection badges={scope} description={description} id="engagement" title="Engagement">
      <StatGrid>
        <StatCard format="duration" info="Half of measured page views end sooner than this." label="Median time on page" value={views ? totals.medianMs : null} />
        <StatCard format="duration" info="A quarter of measured page views last longer than this." label="75th percentile time" value={views ? totals.p75Ms : null} />
        <StatCard format="percent" info={`Share of measured page views lasting at least ${ENGAGED_MS / 1000} seconds.`} label="Engaged views" value={ratio(totals.engagedViews, views)} />
        <StatCard format="percent" info={`Share of measured page views left within ${QUICK_EXIT_MS / 1000} seconds.`} label="Quick exits" value={ratio(totals.quickExits, views)} />
        <StatCard info="Page views with a time_on_page event." label="Measured views" value={views} />
      </StatGrid>
      <DashboardGrid>
        <GridItem lg={4} md={5}>
          <BarListCard
            columns={{ label: "Depth", value: "Share of views" }}
            empty="No scroll_depth events in this range."
            format="percent"
            info="Share of page views with a scroll_depth event that reached at least this far."
            items={scrollViews ? (["25", "50", "75", "100"] as const).map((depth) => ({ label: `${depth}%`, value: data.scrollTotals[`reached${depth}`] })) : []}
            title="Scroll depth"
            total={1}
          />
        </GridItem>
        <GridItem lg={8} md={7}>
          <BarListCard
            color={chartColors.success}
            columns={{ label: "CTA", details: ["Placement"], value: "Clicks", share: "Share" }}
            empty="No cta_click events in this range."
            info="cta_click events grouped by cta_id and placement."
            items={data.ctas.map(({ ctaId, placement, clicks }) => ({ label: ctaId || "(no id)", value: clicks, details: [placement || "–"] }))}
            title="CTA clicks"
          />
        </GridItem>
        <GridItem>
          <DataTableCard
            columns={[
              { key: "path", header: "Path", format: "text" },
              { key: "views", header: "Measured views" },
              { key: "median", header: "Median time", format: "duration" },
              { key: "p75", header: "p75 time", format: "duration" },
              { key: "engaged", header: "Engaged", format: "percent" },
              { key: "quick", header: "Quick exits", format: "percent" },
              { key: "reached50", header: "Scroll 50%", format: "percent" },
              { key: "reached100", header: "Scroll 100%", format: "percent" },
            ]}
            description="Per path. Time columns use time_on_page events, scroll columns use scroll_depth events."
            empty="No engagement events in this range."
            initialSort={{ key: "views", direction: "desc" }}
            rows={paths.map((path) => {
              const time = timeByPath.get(path);
              const scroll = scrollByPath.get(path);
              return {
                path,
                views: time?.views ?? 0,
                median: time ? time.medianMs : null,
                p75: time ? time.p75Ms : null,
                engaged: time ? ratio(time.engagedViews, time.views) : null,
                quick: time ? ratio(time.quickExits, time.views) : null,
                reached50: scroll?.reached50 ?? null,
                reached100: scroll?.reached100 ?? null,
              };
            })}
            title="Page engagement"
          />
        </GridItem>
      </DashboardGrid>
    </DashboardSection>
  );
}
