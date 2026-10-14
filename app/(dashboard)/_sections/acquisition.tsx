import type { ReactNode } from "react";
import type { DashboardData } from "../../../lib/dashboard.ts";
import { formatValue } from "../../../lib/format.ts";
import { BarListCard } from "../../../components/dashboard/bar-list.tsx";
import { CardEmpty, DashboardCard } from "../../../components/dashboard/card.tsx";
import { DataTableCard } from "../../../components/dashboard/data-table-card.tsx";
import { DonutChart } from "../../../components/dashboard/donut-chart.tsx";
import { DashboardGrid, GridItem } from "../../../components/dashboard/grid.tsx";
import { DashboardSection } from "../../../components/dashboard/section.tsx";

export function AcquisitionSection({ data, scope }: { data: DashboardData; scope: ReactNode }) {
  const description = "Where sessions come from, attributed to the referrer and UTM tags of each session's first event.";
  if (!data.hasReferrer) {
    return (
      <DashboardSection description={description} id="acquisition" title="Acquisition">
        <CardEmpty>
          No referrers stored yet. RawTree adds the referrer column with the first event that carries one: send simulated campaign traffic
          from the Console.
        </CardEmpty>
      </DashboardSection>
    );
  }
  const channels = data.channels.map(({ channel, sessions }) => ({ label: channel, value: sessions }));
  const sessions = channels.reduce((sum, { value }) => sum + value, 0);
  const tagged = data.campaigns.reduce((sum, row) => sum + row.sessions, 0);
  return (
    <DashboardSection badges={scope} description={description} id="acquisition" title="Acquisition">
      <DashboardGrid>
        <GridItem lg={4} md={6}>
          <BarListCard
            columns={{ label: "Channel", value: "Sessions", share: "Share" }}
            empty="No sessions in this range."
            info="Direct means no referrer. Search, Social, and Mail are matched by referrer host; anything else is Referral."
            items={channels}
            title="Channels"
          />
        </GridItem>
        <GridItem lg={4} md={6}>
          <DashboardCard description="Share of sessions by first-touch channel." title="Channel mix">
            <DonutChart centerLabel="sessions" items={channels} label="Sessions by first-touch channel" />
          </DashboardCard>
        </GridItem>
        <GridItem lg={4}>
          <BarListCard
            columns={{ label: "Referrer", details: ["Channel"], value: "Sessions", share: "Share" }}
            empty="No sessions in this range."
            info="The referrer host of each session's first event."
            items={data.referrers.map(({ referrer, sessions, channel }) => ({ label: referrer, value: sessions, details: [channel] }))}
            limit={10}
            title="Referrers"
            total={sessions}
          />
        </GridItem>
        <GridItem>
          <DataTableCard
            columns={[
              { key: "source", header: "Source", format: "text" },
              { key: "medium", header: "Medium", format: "text" },
              { key: "campaign", header: "Campaign", format: "text" },
              { key: "sessions", header: "Sessions" },
            ]}
            description={`${formatValue(tagged)} of ${formatValue(sessions)} sessions carry UTM tags.`}
            empty="No UTM-tagged sessions in this range."
            info="Sessions are attributed to the utm_source, utm_medium, and utm_campaign of their first page URL."
            initialSort={{ key: "sessions", direction: "desc" }}
            rows={data.campaigns}
            title="Campaigns"
          />
        </GridItem>
      </DashboardGrid>
    </DashboardSection>
  );
}
