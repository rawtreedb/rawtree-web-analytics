# RawTree Web Analytics

Web analytics on [RawTree](https://rawtree.com): an SDK for events and session recordings, a Next.js collector, and a dashboard with bot detection and session replay. Your events land in your own RawTree tables, so every number on the dashboard is a SQL query you can run yourself.

## 📦 What's inside

- **SDK** ([`@rawtree/analytics`](packages/analytics)): send product-defined events from the browser and your backend, plus rrweb session recordings with masking on by default. Delivery is batched, retried, and at least once.
- **Collector** (`/api/collect`): validates every batch against the event contract and writes it to RawTree with an insert-only key. It acknowledges only after RawTree accepted every row.
- **Dashboard** (`/`): Overview, Traffic, Acquisition, Content, Engagement, and Bots for any date range, compared with the previous period. Bots are told apart by user agent and kept out of every human metric.
- **Recordings** (`/recordings`): browse recent sessions and replay them in the browser.
- **Test console** ([`examples/test-console`](examples/test-console)): a local-only app for sending test events, recordings, crawler visits, and campaign visits, and watching each one reach RawTree.

The dashboard and collector are one Next.js app, meant to be deployed. The test console is a development tool: run it on your machine, don't deploy it.

## 🧭 How it works

```mermaid
flowchart LR
  subgraph app["Your app"]
    browser["Browser<br/>events + recordings"]
    backend["Backend<br/>server events"]
  end

  collector["Collector<br/>/api/collect"]
  tables[("RawTree<br/>events + recordings")]
  dashboard["Dashboard + Recordings<br/>/ and /recordings"]
  agent["Your AI agent<br/>via RawTree MCP"]

  browser -- "@rawtree/analytics" --> collector
  backend -- "@rawtree/analytics/server" --> collector
  collector -- "insert-only key" --> tables
  tables -- "read-only key" --> dashboard
  tables -- "read-only key" --> agent
```

The collector and the dashboard are the same Next.js app. The [test console](examples/test-console) plays "Your app" on your machine, sending through the same SDK to a local collector.

- Events and recording chunks are stored as rows. Sessions, recordings, and their completeness are derived in SQL, not kept in a mutable table.
- Delivery is at least once, so event IDs stay stable across retries and every query deduplicates (`uniqExact(event_id)` or `LIMIT 1 BY`).
- Credentials and table names come from server configuration, never from requests.

## 🌳 Set up RawTree

You need a RawTree account and the [`rtree` CLI](https://rawtree.com/docs/reference/cli). Log in once with `rtree login`, then create a database and two keys: one that can only write, one that can only read.

```sh
rtree database create web_analytics
rtree key create --name web-analytics-ingest --permission write_only --database web_analytics
rtree key create --name web-analytics-query --permission read_only --database web_analytics
```

That's it. The `events` and `recordings` tables are created on the first ingestion, and their columns appear as events arrive.

These keys apply to every database in your cluster. To limit them to the analytics database, use keys bound to [database roles](https://rawtree.com/docs/reference/authentication) instead. Role-bound inserts don't create tables, so create `events` and `recordings` first in that case.

## 🚀 Run it locally

You need Node.js 24 or later.

```sh
cp .env.example .env.local   # set RAWTREE_DATABASE, RAWTREE_INGEST_KEY, RAWTREE_QUERY_KEY
npm install
npm run dev                  # dashboard + collector on http://localhost:3000
```

[`.env.example`](.env.example) documents every variable. Locally, keep `ANALYTICS_ALLOWED_ORIGINS=http://localhost:3001` so the test console can send events.

## 🧪 Use the test console

The console sends data through the SDK exactly as a real app would, using the packed `@rawtree/analytics` tarball.

```sh
npm run console:install                      # from the repo root: pack the SDK and install it in the console
cd examples/test-console && npm start        # http://localhost:3001, reads ../../.env.local
```

1. **Consent:** turn on Analytics. Nothing is sent before that. Turn on Session recording too if you want a replay.
2. **Browser events:** send recipe-shaped events (`page_view`, `cta_click`, `scroll_depth`, and more) or a custom event with your own JSON.
3. **Server events:** send backend events like `signup_completed` with a stable ID. Needs the same `ANALYTICS_SERVER_TOKEN` in the console and the collector. Resending keeps the same ID, and the dashboard still counts it once.
4. **Simulated traffic:** send page views as crawlers (GPTBot, ClaudeBot, Googlebot, curl, and more) or as campaign visits (Google ad, newsletter, Hacker News). Each click is a new visitor. This is how you fill the Bots and Acquisition sections.
5. **Recording playground:** change the page while recording, and check that the input, the `rr-block` region, and the sample secrets stay hidden. "Mask all text" switches to fully masked recordings.
6. **Event viewer:** every row moves from Queued to Sent (collector 200) to Stored (found in RawTree). Reads lag writes by a moment, so Stored can take a few seconds.

Everything you send goes to the database in `.env.local`. Use a separate test database (same setup, another name) if you don't want test data next to real traffic: RawTree can't delete individual rows yet.

## 📊 Use the dashboard

- **Date range:** the picker in the header has presets (Today, This week, Last 7 days, Last month, and more) and a calendar for custom ranges. Days are UTC. Every number is compared with the previous period of the same length.
- **Humans only:** once events carry a user agent, Overview, Traffic, Acquisition, and Content exclude bots. Before that, the sections show an "All traffic" badge.
- **Sections:** Overview has the headline numbers. Traffic has the daily trend and breakdown. Acquisition shows channels, referrers, and UTM campaigns by each session's first touch. Content lists top pages. Engagement covers time on page, scroll depth, and CTA clicks. Bots shows bot page requests, crawler types, top crawlers, and the most crawled paths.
- **Recordings:** pick a session from the list on the left and replay it. Pause, seek, and change speed from the controls under the player. Incomplete recordings replay only their complete stretches and say what was skipped.
- **Tune a widget:** every dashboard query lives in [`lib/queries.ts`](lib/queries.ts), one documented template per widget. Edit the SQL there (for example add a channel host to `SEARCH_HOSTS` or change `ENGAGED_MS`). The aliases are the field names the page reads: if you add or rename one, update that query's row type in `lib/dashboard.ts` and its use in `app/page.tsx`.

## ☁️ Deploy the dashboard

Deploy the Next.js app (for example on Vercel) with these environment variables:

| Variable | Value |
| --- | --- |
| `RAWTREE_API_URL` | Optional. Defaults to `https://api.rawtree.com` |
| `RAWTREE_DATABASE` | Your analytics database |
| `RAWTREE_INGEST_KEY` | The insert-only key, used by the collector |
| `RAWTREE_QUERY_KEY` | The read-only key, used by the dashboard and replay |
| `ANALYTICS_ALLOWED_ORIGINS` | The origins of the sites you track, e.g. `https://example.com` |
| `ANALYTICS_SERVER_TOKEN` | Optional. A random secret for backend events |

Then point the SDK at `https://<your-deployment>/api/collect`.

Before you deploy, know what is public:

- **The dashboard and recordings have no login.** Anyone with the URL sees your analytics and can replay recorded sessions. Keep recordings masked (the default) or put the app behind your own access control if that's not what you want.
- **The collector accepts events from the allowed origins** and has no rate limiting yet. Origin checks stop other websites' browsers, not scripts.
- **Don't deploy the test console.** It holds the server token and is built for local testing.

## ✍️ Add it to your app

```sh
npm install @rawtree/analytics
npm install rrweb@^2.1.7   # only if you use session recording
```

```ts
import { createAnalytics } from "@rawtree/analytics";

// Create the client only after the user allows analytics.
const analytics = createAnalytics({ endpoint: "https://<your-deployment>/api/collect" });
analytics.sendEvent("checkout_started", { plan: "pro" });
```

Then query it, counting each event once:

```sql
SELECT toString(properties.plan) AS plan, uniqExact(toString(event_id)) AS checkouts
FROM events
WHERE toString(event_name) = 'checkout_started'
GROUP BY plan
```

Nothing is tracked automatically: event names and properties are yours. The [SDK README](packages/analytics/README.md) covers options, backend events, and recording privacy. The [tracking recipes](examples/test-console/recipes/RECIPES.md) show page views, CTA clicks, scroll depth, web vitals, signups, and their queries.

## 🤖 Ask your AI agent

Any AI agent or LLM client that speaks MCP can query your analytics through the [RawTree MCP server](https://rawtree.com/docs/reference/mcp). Follow the docs to connect your client of choice, and [use an API key](https://rawtree.com/docs/reference/mcp#hosted-mcp-with-an-api-key) instead of OAuth: give it the **read-only key** from the setup. OAuth grants broad access to your RawTree account, including destructive operations, while the read-only key can only read data.

Give the agent these rules so its numbers match the dashboard:

- Tables: `events` (one row per event) and `recordings` (one row per recording chunk part).
- Delivery is at least once. Count with `uniqExact(toString(event_id))`, never `count()`. Sessions are `uniqExact(toString(session_id))`, visitors are `uniqExact(toString(anonymous_id))`.
- Fields are dynamic JSON. Cast them: `toString(event_name)`, `CAST(occurred_at_ms AS Int64)`, `toString(properties.plan)`.
- Time is `occurred_at_ms` (epoch milliseconds, UTC). Always filter on an explicit window.
- Page views are `event_name = 'page_view'`, with `page_path`, `page_url`, and `referrer` on the row.
- Bots are told apart by `user_agent`. The dashboard's pattern is `BOT_UA_PATTERN` in [`lib/crawlers.ts`](lib/crawlers.ts).

The [tracking recipes](examples/test-console/recipes/RECIPES.md) and [`lib/queries.ts`](lib/queries.ts) (every dashboard query) have more queries to borrow from.

## 🔒 Privacy notes

- Session recording masks all text and inputs by default. `maskAllText: false` shows page text while inputs stay masked. Elements with `rr-block` are never recorded.
- Page URLs keep only allowlisted query parameters (`utm_*` by default) and drop credentials and fragments.
- RawTree can't delete individual rows yet, so plan retention before collecting real users.

## 🛠️ Development

```sh
npm test             # builds the SDK, runs SDK and collector/dashboard tests
npm run typecheck
npm run build        # SDK + Next.js
cd examples/test-console && npx tsc --noEmit && npm run build && npm run size && npm run smoke
```

Automated tests never touch your real tables: they use temporary tables named with `RAWTREE_TABLE_PREFIX`. Node runs the `.ts` sources directly, so use erasable syntax only and `.ts` extensions in relative imports.

| Path | What |
| --- | --- |
| `packages/analytics/` | The SDK. `src/protocol.ts` is the event contract for both the SDK and the collector |
| `app/`, `components/` | Dashboard, recordings, and the collector route |
| `lib/` | Collector, RawTree client, dashboard SQL, crawler classifier, recording reassembly |
| `examples/test-console/` | Test console and tracking recipes |
| `test/` | Collector and dashboard tests |
| `IMPLEMENTATION.md` | Plan, milestones, and the session ledger |
| `AGENTS.md` | Guide for coding agents working in this repo |

## 📄 License

[Apache-2.0](LICENSE)
