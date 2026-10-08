// The dashboard: Overview, Traffic, Acquisition, Content, Engagement, and Bots for one
// date range, compared with the previous period of equal length. Layout and cards follow
// Treewatcher's growth dashboard. All SQL lives in lib/dashboard.ts (getDashboard);
// this page only folds rows for display. Every count is deduplicated by ID in SQL.

import {
  DashboardQueryError,
  campaignRows,
  getDashboard,
  isBotUa,
  loadQueryConfig,
  previousRange,
  resolveRange,
  sessionsByChannel,
  sessionsByReferrer,
  type BaseTotals,
  type BotSplit,
  type DashboardData,
  type ResolvedRange,
  type SearchParamsLike,
  type TrendRow,
} from "../lib/dashboard.ts";
import { summarizeCrawlers } from "../lib/crawlers.ts";
import { formatValue, ratio, relativeChange } from "../lib/format.ts";
import { DateFilter } from "../components/date/date-filter.tsx";
import { DataTableCard, DonutChart, MetricChartCard, StatCard, type ChartRow } from "../components/charts.tsx";
import {
  Badge,
  BarListCard,
  CardEmpty,
  DashboardCard,
  DashboardGrid,
  DashboardSection,
  ErrorCard,
  GridItem,
  PageToolbar,
  SegmentedLinks,
  StatGrid,
  chartColors,
  crawlerCategoryColors,
} from "../components/ui.tsx";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const number = new Intl.NumberFormat("en");
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const instant = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const formatWindow = ({ fromMs, toMs }: { fromMs: number; toMs: number }) => `${instant.format(fromMs)} – ${instant.format(toMs)} UTC`;

// --- Folding ------------------------------------------------------------------------

/** Human totals when user agents exist, otherwise all traffic. */
function humanTotals(totals: BaseTotals, split: BotSplit | null): BaseTotals {
  return split
    ? { events: split.humanEvents, sessions: split.humanSessions, visitors: split.humanVisitors, pageViews: split.humanPageViews }
    : totals;
}

/**
 * Continuous UTC days for the window, zero-filled, with day N of the previous period
 * on the same row so the dashed comparison line lines up.
 */
function dailyRows(range: ResolvedRange, current: TrendRow[], previous: TrendRow[]): ChartRow[] {
  const start = Math.floor(range.fromMs / DAY_MS) * DAY_MS;
  const previousStart = Math.floor(previousRange(range).fromMs / DAY_MS) * DAY_MS;
  const days = Math.max(1, Math.ceil((range.toMs - start) / DAY_MS));
  const byDay = (rows: TrendRow[]) => new Map(rows.map((row) => [row.dayMs, row]));
  const currentByDay = byDay(current);
  const previousByDay = byDay(previous);
  return Array.from({ length: days }, (_, index) => {
    const now = currentByDay.get(start + index * DAY_MS);
    const before = previousByDay.get(previousStart + index * DAY_MS);
    return {
      day: dayOf(start + index * DAY_MS),
      previousDay: dayOf(previousStart + index * DAY_MS),
      pageViews: now?.pageViews ?? 0,
      previousPageViews: before?.pageViews ?? 0,
      sessions: now?.sessions ?? 0,
      previousSessions: before?.sessions ?? 0,
      visitors: now?.visitors ?? 0,
      previousVisitors: before?.visitors ?? 0,
      events: now?.events ?? 0,
      previousEvents: before?.events ?? 0,
      botEvents: now?.botEvents ?? 0,
      previousBotEvents: before?.botEvents ?? 0,
      botRequests: now?.botPageViews ?? 0,
      previousBotRequests: before?.botPageViews ?? 0,
    };
  });
}

/** Paths grouped by their first segment ("/docs/a" → "/docs"). */
function siteSections(pages: DashboardData["topPaths"]) {
  const counts = new Map<string, number>();
  for (const { path, pageViews } of pages) {
    const section = `/${path.split("/").filter(Boolean)[0] ?? ""}`;
    counts.set(section, (counts.get(section) ?? 0) + pageViews);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}

// --- Header ---------------------------------------------------------------------------

function RangeFilter({ range }: { range: ResolvedRange }) {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return (
    <DateFilter
      maxDay={day(Date.now())}
      preset={range.key === "custom" ? null : range.key}
      range={{ from: day(range.fromMs), to: day(range.toMs - 1) }}
    />
  );
}

// --- Page -------------------------------------------------------------------------------

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  const range = resolveRange(await searchParams);
  let data: DashboardData | undefined;
  let error: string | undefined;
  try {
    data = await getDashboard(loadQueryConfig(), range);
  } catch (caught) {
    if (caught instanceof DashboardQueryError) {
      error = caught.message;
    } else {
      console.error("dashboard query failed", caught);
      error = "Could not reach RawTree. Check the server logs and the RAWTREE_QUERY_KEY configuration.";
    }
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
      {data ? <Dashboard data={data} range={range} /> : <ErrorCard>{error}</ErrorCard>}
    </div>
  );
}

function Dashboard({ data, range }: { data: DashboardData; range: ResolvedRange }) {
  const rows = dailyRows(range, data.daily, data.previousDaily);
  const now = humanTotals(data.current, data.botSplit);
  const before = humanTotals(data.previous, data.previousBotSplit);
  const hasAgents = data.botSplit !== null;
  const scope = hasAgents ? (
    <Badge variant="success">Humans only</Badge>
  ) : (
    <Badge title="No event has stored a user agent yet, so bots cannot be told apart." variant="warning">
      All traffic
    </Badge>
  );
  const pagesPerSession = (totals: BaseTotals) => ratio(totals.pageViews, totals.sessions);
  const botEvents = (totals: BaseTotals, split: BotSplit | null) => (split ? totals.events - split.humanEvents : 0);
  const botShare = (totals: BaseTotals, split: BotSplit | null) => (split ? ratio(botEvents(totals, split), totals.events) : null);
  const pointChange = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  const noEvents = data.current.events === 0;

  return (
    <div className="grid gap-9">
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
              change={pointChange(botShare(data.current, data.botSplit), botShare(data.previous, data.previousBotSplit))}
              changeKind="points"
              format="percent"
              info="Bot events as a share of all events."
              label="Bot share"
              neutral
              trend={rows.map((row) => ratio(Number(row.botEvents), Number(row.botEvents) + Number(row.events)) ?? 0)}
              trendColor={chartColors.muted}
              value={botShare(data.current, data.botSplit)}
            />
          ) : null}
        </StatGrid>
        {noEvents ? <CardEmpty>No events in this range. Send some from the test console, or widen the date range.</CardEmpty> : null}
      </DashboardSection>

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
              totals={{ day: "Range", pageViews: now.pageViews, sessions: now.sessions, visitors: now.visitors, events: now.events, botEvents: botEvents(data.current, data.botSplit) }}
            />
          </GridItem>
        </DashboardGrid>
      </DashboardSection>

      <AcquisitionSection data={data} scope={scope} />
      <ContentSection data={data} now={now} scope={scope} />
      <EngagementSection data={data} />
      <BotsSection data={data} rows={rows} />
    </div>
  );
}

function AcquisitionSection({ data, scope }: { data: DashboardData; scope: React.ReactNode }) {
  const description = "Where sessions come from, attributed to the referrer and UTM tags of each session's first event.";
  if (data.firstTouch === null) {
    return (
      <DashboardSection description={description} id="acquisition" title="Acquisition">
        <CardEmpty>
          No referrers stored yet. RawTree adds the referrer column with the first event that carries one: open the test console from a
          link or a UTM-tagged URL to send one.
        </CardEmpty>
      </DashboardSection>
    );
  }
  const channels = sessionsByChannel(data.firstTouch).map(({ label, sessions }) => ({ label, value: sessions }));
  const referrers = sessionsByReferrer(data.firstTouch);
  const campaigns = campaignRows(data.firstTouch);
  const sessions = data.firstTouch.length;
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
            items={referrers.map(({ label, sessions, channel }) => ({ label, value: sessions, details: [channel] }))}
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
            description={`${number.format(campaigns.reduce((sum, row) => sum + row.sessions, 0))} of ${number.format(sessions)} sessions carry UTM tags.`}
            empty="No UTM-tagged sessions in this range."
            info="Sessions are attributed to the utm_source, utm_medium, and utm_campaign of their first page URL."
            initialSort={{ key: "sessions", direction: "desc" }}
            rows={campaigns}
            title="Campaigns"
          />
        </GridItem>
      </DashboardGrid>
    </DashboardSection>
  );
}

function ContentSection({ data, now, scope }: { data: DashboardData; now: BaseTotals; scope: React.ReactNode }) {
  const previous = new Map(data.previousTopPaths.map((row) => [row.path, row.pageViews]));
  return (
    <DashboardSection badges={scope} description="Page views by path, compared with the previous period." id="content" title="Content">
      <DashboardGrid>
        <GridItem lg={8} md={7}>
          <BarListCard
            columns={{ label: "Path", details: ["Visitors"], value: "Views", share: "Share", change: "Change" }}
            empty="No page views in this range."
            info="Share is of all page views in the range. Change is against the same path in the previous period."
            items={data.topPaths.map((row) => ({
              label: row.path,
              value: row.pageViews,
              details: [number.format(row.visitors)],
              change: relativeChange(row.pageViews, previous.get(row.path) ?? null),
            }))}
            limit={10}
            title="Top pages"
            total={now.pageViews}
          />
        </GridItem>
        <GridItem lg={4} md={5}>
          <DashboardCard description="Page views grouped by first path segment." title="Site sections">
            <DonutChart centerLabel="page views" items={siteSections(data.topPaths)} label="Page views by site section" />
          </DashboardCard>
        </GridItem>
      </DashboardGrid>
    </DashboardSection>
  );
}

function EngagementSection({ data }: { data: DashboardData }) {
  const description = "Time on page and scroll depth per page view (deduplicated by page_view_id), plus CTA clicks.";
  const totals = data.timeTotals;
  const scrollViews = data.scroll.reduce((sum, row) => sum + row.views, 0);
  if ((!totals || totals.views === 0) && scrollViews === 0 && data.ctas.length === 0) {
    return (
      <DashboardSection description={description} id="engagement" title="Engagement">
        <CardEmpty>No time_on_page, scroll_depth, or cta_click events in this range.</CardEmpty>
      </DashboardSection>
    );
  }
  const weighted = (key: "reached25" | "reached50" | "reached75" | "reached100") =>
    scrollViews === 0 ? 0 : data.scroll.reduce((sum, row) => sum + row[key] * row.views, 0) / scrollViews;
  const scrollByPath = new Map(data.scroll.map((row) => [row.path, row]));
  const paths = [...new Set([...data.timeOnPage.map((row) => row.path), ...data.scroll.map((row) => row.path)])];
  const timeByPath = new Map(data.timeOnPage.map((row) => [row.path, row]));
  const views = totals?.views ?? 0;

  return (
    <DashboardSection description={description} id="engagement" title="Engagement">
      <StatGrid>
        <StatCard format="duration" info="Half of measured page views end sooner than this." label="Median time on page" value={views ? totals?.medianMs ?? null : null} />
        <StatCard format="duration" info="A quarter of measured page views last longer than this." label="75th percentile time" value={views ? totals?.p75Ms ?? null : null} />
        <StatCard format="percent" info="Share of measured page views lasting at least 10 seconds." label="Engaged views" value={ratio(totals?.engagedViews ?? 0, views)} />
        <StatCard format="percent" info="Share of measured page views left within 5 seconds." label="Quick exits" value={ratio(totals?.quickExits ?? 0, views)} />
        <StatCard info="Page views with a time_on_page event." label="Measured views" value={views} />
      </StatGrid>
      <DashboardGrid>
        <GridItem lg={4} md={5}>
          <BarListCard
            columns={{ label: "Depth", value: "Share of views" }}
            empty="No scroll_depth events in this range."
            format="percent"
            info="Share of page views with a scroll_depth event that reached at least this far."
            items={scrollViews ? (["25", "50", "75", "100"] as const).map((depth) => ({ label: `${depth}%`, value: weighted(`reached${depth}`) })) : []}
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

function BotsSection({ data, rows }: { data: DashboardData; rows: ChartRow[] }) {
  const description = "Crawlers, AI agents, and automated browsers, excluded from every human metric. Bots are identified from their user agent.";
  if (data.botSplit === null) {
    return (
      <DashboardSection description={description} id="bots" title="Bots">
        <CardEmpty>
          No user agents stored yet. The SDK sends navigator.userAgent with every event (and the collector falls back to the request
          header); RawTree adds the column with the first such event. Send simulated bot events from the test console to fill this section.
        </CardEmpty>
      </DashboardSection>
    );
  }
  // Like Treewatcher, the unit is page requests: page_view events from bot user agents.
  const botRequests = (totals: BaseTotals, split: BotSplit | null) => (split ? totals.pageViews - split.humanPageViews : null);
  const botShare = (totals: BaseTotals, split: BotSplit | null) => {
    const bots = botRequests(totals, split);
    return bots === null || !split ? null : ratio(bots, bots + split.humanPageViews);
  };
  const botsPerHuman = (totals: BaseTotals, split: BotSplit | null) => {
    const bots = botRequests(totals, split);
    return bots === null || !split ? null : ratio(bots, split.humanPageViews);
  };
  const pointChange = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  const now = botRequests(data.current, data.botSplit) ?? 0;
  const before = botRequests(data.previous, data.previousBotSplit);
  const perHuman = botsPerHuman(data.current, data.botSplit);
  const summary = data.uaGroups
    ? summarizeCrawlers(
        data.uaGroups.filter((group) => isBotUa(group.userAgent) && group.pageViews > 0).map((group) => ({ userAgent: group.userAgent, hits: group.pageViews })),
      )
    : null;
  const ai = (summary?.categories ?? []).filter(({ label }) => label === "AI retrieval" || label === "AI training").reduce((sum, { hits }) => sum + hits, 0);
  const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });
  const paths = data.botPaths ?? [];

  return (
    <DashboardSection badges={<Badge variant="info">bot page_view</Badge>} description={description} id="bots" title="Bots">
      <StatGrid>
        <StatCard
          change={relativeChange(now, before)}
          info="Distinct page_view events whose user agent matches the crawler pattern."
          label="Bot page requests"
          neutral
          trend={rows.map((row) => Number(row.botRequests))}
          trendColor={chartColors.muted}
          value={now}
        />
        <StatCard
          change={pointChange(botShare(data.current, data.botSplit), botShare(data.previous, data.previousBotSplit))}
          changeKind="points"
          format="percent"
          info="Bot page requests as a share of bot requests plus human page views."
          label="Bot share of page requests"
          neutral
          value={botShare(data.current, data.botSplit)}
        />
        <StatCard
          change={relativeChange(perHuman, botsPerHuman(data.previous, data.previousBotSplit))}
          format="ratio"
          hint={perHuman === null ? undefined : `${formatValue(perHuman, "decimal")} bot requests per human page view`}
          info="Human page views to bot page requests. Unavailable when there are no human page views."
          label="Human to bot ratio"
          neutral
          value={perHuman}
        />
        <StatCard
          hint={now ? `${percent.format(ai / now)} of bot requests` : undefined}
          info="Requests from crawlers identified as AI retrieval (fetching pages for answers) or AI training (collecting corpora)."
          label="AI crawler requests"
          value={ai}
        />
        <StatCard
          hint={summary?.crawlers[0] ? `Top: ${summary.crawlers[0].name}` : undefined}
          info="Distinct crawler names among the bot user agents in the range."
          label="Distinct crawlers"
          value={summary?.crawlers.length ?? 0}
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
                previousTotal: before,
                series: [{ key: "botRequests", label: "Bot page requests", color: chartColors.muted, comparisonKey: "previousBotRequests" }],
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
            {summary?.categories.length ? (
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
            items={(summary?.crawlers ?? []).map((crawler) => ({
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
            items={paths.map(({ path, requests }) => ({ label: path, value: requests }))}
            limit={10}
            title="Most crawled paths"
            total={now}
          />
        </GridItem>
      </DashboardGrid>
    </DashboardSection>
  );
}
