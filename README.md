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

```
your app ──@rawtree/analytics──▶ /api/collect ──insert-only key──▶ RawTree: events, recordings
                                                                        │
dashboard + replay ◀─────────────────── read-only key ─────────────────┘
```

- Events and recording chunks are stored as rows. Sessions, recordings, and their completeness are derived in SQL, not kept in a mutable table.
- Delivery is at least once, so event IDs stay stable across retries and every query deduplicates (`uniqExact(event_id)` or `LIMIT 1 BY`).
- Credentials and table names come from server configuration, never from requests.

## 🌳 Set up RawTree

You need a RawTree account and the [`rtree` CLI](https://rawtree.com/docs/reference/cli). Log in once with `rtree login`. The examples use a database called `web_analytics`.

### 1. Create the database and tables

```sh
rtree database create web_analytics
rtree table create events --database web_analytics --sorting-key "event_name, occurred_at_ms"
rtree table create recordings --database web_analytics --sorting-key "recording_id, chunk_seq, part_index"
```

Create both tables up front. The app writes with a role-bound key, and those inserts never create tables on their own. Columns appear automatically as the first events arrive, so there's no schema to declare.

### 2. Create two roles: one that only inserts, one that only reads

```sh
rtree query --database web_analytics "CREATE ROLE web_analytics_ingest"
rtree query --database web_analytics "GRANT INSERT ON web_analytics.* TO web_analytics_ingest"
rtree query --database web_analytics "CREATE ROLE web_analytics_query"
rtree query --database web_analytics "GRANT SELECT ON web_analytics.* TO web_analytics_query"
```

### 3. Create one API key per role

Role-bound keys are created through the API with an admin API key (or as an organization admin). See [database roles](https://rawtree.com/docs/reference/authentication) in the RawTree docs.

```sh
curl -X POST "https://api.rawtree.com/v1/keys?database=web_analytics" \
  -H "Authorization: Bearer $RAWTREE_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"web-analytics-ingest","database_roles":["web_analytics_ingest"]}'
# Repeat with "web-analytics-query" and ["web_analytics_query"].
```

Use the admin key only for this setup. The app itself never needs it: the collector gets the insert-only key and the dashboard gets the read-only key.

## 🚀 Run it locally

You need Node.js 24 or later.

```sh
cp .env.example .env.local   # set RAWTREE_DATABASE, RAWTREE_INGEST_KEY, RAWTREE_QUERY_KEY
npm install
PORT=3100 npm run dev        # dashboard + collector on http://localhost:3100
```

[`.env.example`](.env.example) documents every variable. Locally, keep `ANALYTICS_ALLOWED_ORIGINS=http://localhost:5173` so the test console can send events.

## 🧪 Use the test console

The console sends data through the SDK exactly as a real app would, using the packed `@rawtree/analytics` tarball.

```sh
npm run console:install                      # from the repo root: pack the SDK and install it in the console
cd examples/test-console && npm start        # http://localhost:5173, reads ../../.env.local
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

## ☁️ Deploy the dashboard

Deploy the Next.js app (for example on Vercel) with these environment variables:

| Variable | Value |
| --- | --- |
| `RAWTREE_API_URL` | `https://api.rawtree.com` |
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
