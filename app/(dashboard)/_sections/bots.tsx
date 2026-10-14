import { summarizeCrawlers, type CrawlerCategory } from "../../../lib/crawlers.ts";
import type { DashboardData, Totals } from "../../../lib/dashboard.ts";
import { formatValue, ratio, relativeChange } from "../../../lib/format.ts";
import { BarListCard } from "../../../components/dashboard/bar-list.tsx";
import { CardEmpty, DashboardCard } from "../../../components/dashboard/card.tsx";
import { chartColors } from "../../../components/dashboard/colors.ts";
import { DonutChart } from "../../../components/dashboard/donut-chart.tsx";
import { DashboardGrid, GridItem, StatGrid } from "../../../components/dashboard/grid.tsx";
import { MetricChartCard, type ChartRow } from "../../../components/dashboard/metric-chart-card.tsx";
import { DashboardSection } from "../../../components/dashboard/section.tsx";
import { StatCard } from "../../../components/dashboard/stat-card.tsx";
import { Badge } from "../../../components/ui/badge.tsx";
import { pointChange } from "./point-change.ts";

// Bots are counted in page requests: page_view events from bot user agents.
const botShare = (totals: Totals) => ratio(totals.botPageViews, totals.botPageViews + totals.pageViews);
const botsPerHuman = (totals: Totals) => ratio(totals.botPageViews, totals.pageViews);

/** Fixed per crawler type so the donut and tables use the same color in every window. */
const crawlerCategoryColors: Record<CrawlerCategory, string> = {
  "AI retrieval": "var(--chart-cat-1)",
  "AI training": "var(--chart-cat-6)",
  "Search indexer": "var(--chart-cat-2)",
  "Social preview": "var(--chart-cat-3)",
  "SEO tool": "var(--chart-cat-5)",
  "Script or headless": "var(--chart-cat-4)",
  Other: "var(--chart-muted)",
};

export function BotsSection({ data, rows }: { data: DashboardData; rows: ChartRow[] }) {
  const description = "Crawlers, AI agents, and automated browsers, excluded from every human metric. Bots are identified from their user agent.";
  if (!data.hasUserAgent) {
    return (
      <DashboardSection description={description} id="bots" title="Bots">
        <CardEmpty>
          No user agents stored yet. The SDK sends navigator.userAgent with every event (and the collector falls back to the request
          header); RawTree adds the column with the first such event. Send simulated bot traffic from the Console to fill this section.
        </CardEmpty>
      </DashboardSection>
    );
  }
  const current = data.current.totals;
  const previous = data.previous.totals;
  const now = current.botPageViews;
  const perHuman = botsPerHuman(current);
  const summary = summarizeCrawlers(data.botAgents);
  const ai = summary.categories.filter(({ label }) => label === "AI retrieval" || label === "AI training").reduce((sum, { hits }) => sum + hits, 0);

  return (
    <DashboardSection badges={<Badge variant="info">bot page_view</Badge>} description={description} id="bots" title="Bots">
      <StatGrid>
        <StatCard
          change={relativeChange(now, previous.botPageViews)}
          info="Distinct page_view events whose user agent matches the crawler pattern."
          label="Bot page requests"
          neutral
          trend={rows.map((row) => Number(row.botPageViews))}
          trendColor={chartColors.muted}
          value={now}
        />
        <StatCard
          change={pointChange(botShare(current), botShare(previous))}
          changeKind="points"
          format="percent"
          info="Bot page requests as a share of bot requests plus human page views."
          label="Bot share of page requests"
          neutral
          value={botShare(current)}
        />
        <StatCard
          change={relativeChange(perHuman, botsPerHuman(previous))}
          format="ratio"
          hint={perHuman === null ? undefined : `${formatValue(perHuman, "decimal")} bot requests per human page view`}
          info="Human page views to bot page requests. Unavailable when there are no human page views."
          label="Human to bot ratio"
          neutral
          value={perHuman}
        />
        <StatCard
          hint={now ? `${formatValue(ai / now, "percent")} of bot requests` : undefined}
          info="Requests from crawlers identified as AI retrieval (fetching pages for answers) or AI training (collecting corpora)."
          label="AI crawler requests"
          value={ai}
        />
        <StatCard
          hint={summary.crawlers[0] ? `Top: ${summary.crawlers[0].name}` : undefined}
          info="Distinct crawler names among the bot user agents in the range."
          label="Distinct crawlers"
          value={summary.crawlers.length}
        />
      </StatGrid>
      <DashboardGrid>
        <GridItem xl={8}>
          <MetricChartCard
            data={rows}
            info="Days are UTC. Day N of the range is compared with day N of the previous period."
            metrics={[
              {
                id: "bots",
                label: "Bot requests",
                neutral: true,
                total: now,
                previousTotal: previous.botPageViews,
                series: [{ key: "botPageViews", label: "Bot page requests", color: chartColors.muted, comparisonKey: "previousBotPageViews" }],
              },
            ]}
            title="Bot requests"
          />
        </GridItem>
        <GridItem lg={6} xl={4}>
          <DashboardCard
            description="Bot page requests by crawler purpose."
            info="AI retrieval fetches pages to answer questions or power AI search. AI training collects corpora. Indexers feed search engines. Social bots unfurl shared links."
            title="Bot types"
          >
            {summary.categories.length ? (
              <DonutChart
                centerLabel="requests"
                items={summary.categories.map(({ label, hits }) => ({ label, value: hits, color: crawlerCategoryColors[label] }))}
                label="Bot page requests by crawler type"
                maxSlices={7}
              />
            ) : (
              <CardEmpty>No bot requests in this range.</CardEmpty>
            )}
          </DashboardCard>
        </GridItem>
        <GridItem lg={6} xl={6}>
          <BarListCard
            color={chartColors.muted}
            columns={{ label: "Crawler", details: ["Type"], value: "Requests", share: "Share" }}
            empty="No bot requests in this range."
            info="Crawlers grouped from their user agents. Unknown bots keep their own bot, crawler, or spider token."
            items={summary.crawlers.map((crawler) => ({
              label: crawler.name,
              value: crawler.hits,
              color: crawlerCategoryColors[crawler.category],
              details: [{ label: crawler.category, color: crawlerCategoryColors[crawler.category] }],
            }))}
            limit={10}
            title="Top crawlers"
            total={now}
          />
        </GridItem>
        <GridItem xl={6}>
          <BarListCard
            color={chartColors.muted}
            columns={{ label: "Path", value: "Requests", share: "Share" }}
            empty="No bot requests in this range."
            info="Paths of page_view events from bots."
            items={data.botPaths.map(({ path, requests }) => ({ label: path, value: requests }))}
            limit={10}
            title="Most crawled paths"
            total={now}
          />
        </GridItem>
      </DashboardGrid>
    </DashboardSection>
  );
}
