# RawTree Web Analytics

Web analytics on [RawTree](https://rawtree.com): an SDK for events and session recordings, a Next.js collector, and a dashboard with bot detection and session replay. Your events land in your own RawTree tables, so every number on the dashboard is a SQL query you can run yourself.

![RawTree Web Analytics dashboard](public/overview.jpg)

## 📦 What's inside

- **SDK** ([`@rawtree/analytics`](packages/analytics)): send product-defined events from the browser and your backend, plus rrweb session recordings with masking on by default. Delivery is batched, retried, and at least once.
- **Collector** (`/api/collect`): validates every batch against the event contract and writes it to RawTree with an insert-only key. It acknowledges only after RawTree accepted every row.
- **Dashboard** (`/`): Overview, Traffic, Acquisition, Content, Engagement, and Bots for any date range, compared with the previous period. Bots are told apart by user agent and kept out of every human metric.
- **Recordings** (`/recordings`): browse recent sessions and replay them in the browser.
- **Console** (`/console`): send test events, recordings, crawler visits, and campaign visits through the SDK, and watch each one reach RawTree.

The dashboard, console, and collector are one Next.js app, meant to be deployed.

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
  tables -- "read-only key or sign-in" --> dashboard
  tables -- "read-only key" --> agent
```

The collector and the dashboard are the same Next.js app. Its Console page plays "Your app", sending through the same SDK to its own collect route.

- Events and recording chunks are stored as rows. Sessions, recordings, and their completeness are derived in SQL, not kept in a mutable table.
- Delivery is at least once, so event IDs stay stable across retries and every query deduplicates.
- `/api/collect` writes only with the insert key from server configuration. The dashboard and console use either the server's keys or the signed-in visitor's own access, and only ever run the dashboard's own SQL: never SQL or table names from the browser.

## 🌳 Set up RawTree

You need a RawTree account and the [`rtree` CLI](https://rawtree.com/docs/reference/cli). Log in once with `rtree login`, then create a database and two keys: one that can only write, one that can only read.

```sh
rtree database create web_analytics
rtree key create --name web-analytics-ingest --permission write_only --database web_analytics
rtree key create --name web-analytics-query --permission read_only --database web_analytics
```

That's it. The `events` and `recordings` tables are created on the first ingestion, and their columns appear as events arrive.

`--database` only sets the key's default database. The permission itself (`write_only`, `read_only`) applies to every database in your cluster. To limit a key to the analytics database, use a key bound to [database roles](https://rawtree.com/docs/reference/authentication) instead. Role-bound inserts don't create tables, so create `events` and `recordings` first in that case.

## 🚀 Run it locally

You need Node.js 24 or later.

```sh
cp .env.example .env.local   # set RAWTREE_DATABASE, RAWTREE_INGEST_KEY, RAWTREE_QUERY_KEY, ANALYTICS_ALLOWED_ORIGINS
npm install
npm run dev                  # dashboard + collector on http://localhost:3000
```

[`.env.example`](.env.example) documents every variable. With both keys set, the dashboard opens without signing in. Leave `RAWTREE_QUERY_KEY` empty to try sign-in mode instead (see [Sign-in mode](#sign-in-mode-a-public-dashboard)).

## ✍️ Add it to your app

```sh
npm install @rawtree/analytics
```

```ts
import { createAnalytics } from "@rawtree/analytics";

// Create the client only after the user allows analytics.
const analytics = createAnalytics({ endpoint: "https://<your-deployment>/api/collect" });
analytics.sendEvent("checkout_started", { plan: "pro" });
```

Add your site's origin to `ANALYTICS_ALLOWED_ORIGINS`. Nothing is tracked automatically: event names and properties are yours. The [SDK README](packages/analytics/README.md) covers options, backend events, session recording, and the stored columns. The [tracking recipes](examples/recipes/RECIPES.md) show page views, CTA clicks, scroll depth, web vitals, signups, and their queries.

## ☁️ Deploy the dashboard

Deploy the Next.js app (for example on Vercel) in one of two modes, chosen by its environment variables.

| Variable | Value |
| --- | --- |
| `RAWTREE_API_URL` | Optional. Defaults to `https://api.rawtree.com` |
| `RAWTREE_DATABASE` | Required for the collector. Your analytics database |
| `RAWTREE_INGEST_KEY` | Required for the collector. The insert-only key |
| `ANALYTICS_ALLOWED_ORIGINS` | Required for the collector. The origins of the sites you track, e.g. `https://example.com` |
| `RAWTREE_QUERY_KEY` | The read-only key. Set it for env mode, leave it empty for sign-in mode |
| `RAWTREE_CONNECTOR` | Optional, sign-in mode only. The Vercel Connect connector, e.g. `rawtree/web-analytics` |
| `ANALYTICS_SERVER_TOKEN` | Optional. A random secret for backend events |

Then point the SDK at `https://<your-deployment>/api/collect`. The collector works the same in both modes: it always writes to `RAWTREE_DATABASE` with `RAWTREE_INGEST_KEY`, and accepts browsers only from `ANALYTICS_ALLOWED_ORIGINS`. If any of the three is missing, it answers `500 collector_not_configured`.

### Env mode: a private dashboard

Set both `RAWTREE_QUERY_KEY` and `RAWTREE_INGEST_KEY`. There is no sign-in: **anyone with the URL sees your analytics, replays recorded sessions, and can send test data from the console.** Use it on your machine or behind your own access control (for example Vercel Deployment Protection).

### Sign-in mode: a public dashboard

Leave `RAWTREE_QUERY_KEY` empty. Keep `RAWTREE_INGEST_KEY`, `RAWTREE_DATABASE`, and `ANALYTICS_ALLOWED_ORIGINS` set if the deployment also collects your sites' events. Every page asks visitors to sign in with their own RawTree access, and shows only their own database. The dashboard and the console use the visitor's access, never the server's keys. Your tracked sites still write to `RAWTREE_DATABASE`, whoever signs in.

- **Connect with RawTree** (when `RAWTREE_CONNECTOR` is set): the visitor approves access with their RawTree account through Vercel Connect, then picks the organization, cluster, and database. The browser only holds an opaque, HTTP-only session cookie. Vercel Connect stores and refreshes the grant. Sign out revokes it.
- **Use an API key:** the visitor pastes one key and a database name (default `web_analytics`). The key must **read and write** that database: the dashboard reads it and the console writes test events to it. Create one with `rtree key create --name web-analytics --permission read_write --database web_analytics`. Like the keys above, it covers the whole cluster. A key limited to one database needs a role with `GRANT SELECT, INSERT ON web_analytics.*`, and then the tables must exist first. The key is kept in an HTTP-only session cookie until sign-out or the browser closes.

RawTree OAuth grants are not read-only, so the server only runs the dashboard's own queries ([`lib/queries.ts`](lib/queries.ts)) and collector-validated inserts with them. It never accepts SQL or table names from the browser.

To enable Connect, create a Vercel Connect connector for the RawTree API from the linked project directory and expose its UID as `RAWTREE_CONNECTOR`:

```sh
vercel link
vercel connect create rawtree --target api --name <name>
vercel env add RAWTREE_CONNECTOR   # e.g. rawtree/<name>
vercel env pull .env.vercel        # for local development: copy VERCEL_OIDC_TOKEN into .env.local
```

Plain `vercel env pull` overwrites `.env.local`, including your RawTree keys, so pull into another file. The OIDC token expires: pull it again when Connect stops working locally. Connect needs a Vercel deployment (or that token locally). Elsewhere, visitors sign in with an API key.

### Before you deploy

- **The collector accepts events from the allowed origins** and doesn't rate limit. Origin checks stop other websites' browsers, not scripts, so add rate limiting for `/api/collect` on your platform if you need it (for example a firewall rule on Vercel).
- **Recordings replay what was recorded.** Keep recordings masked (the default) unless you're sure about what your pages show.

## 📊 Use the dashboard

- **Sign in:** only in sign-in mode. Connect with RawTree or paste an API key, and the sidebar shows which database you're looking at and a Sign out button.
- **Date range:** the picker in the header has presets (Today, This week, Last 7 days, Last month, and more) and a calendar for custom ranges. Days are UTC. Every number is compared with the previous period of the same length.
- **Humans only:** once the events table has a `user_agent` column, every section except Bots excludes bots. Before that, the sections show an "All traffic" badge.
- **Sections:** Overview has the headline numbers. Traffic has the daily trend and breakdown. Acquisition shows channels, referrers, and UTM campaigns by each session's first touch. Content lists top pages. Engagement covers time on page, scroll depth, and CTA clicks. Bots shows bot page requests, crawler types, top crawlers, and the most crawled paths.
- **Recordings:** pick a session from the list on the left and replay it. Pause, seek, and change speed from the controls under the player. Incomplete recordings replay only their complete stretches and say what was skipped.

## 🧪 Use the console

Open **Console** in the dashboard's sidebar (`/console`). It sends data through `@rawtree/analytics` exactly as a real app would, to `/api/console/collect`: the same validation and insert path as `/api/collect`, but with your own access (the env keys in env mode, your sign-in in sign-in mode), so test data only lands in your database. It needs no allowed origin or server token.

1. **Consent:** turn on Analytics. Nothing is sent before that. Turn on Session recording too if you want a replay.
2. **Browser events:** send recipe-shaped events (`page_view`, `cta_click`, `scroll_depth`, and more) or a custom event with your own JSON.
3. **Server events:** send backend events like `signup_completed` with a stable ID, through `@rawtree/analytics/server` on the app's server. Resending keeps the same ID, and the dashboard still counts it once.
4. **Simulated traffic:** send page views as crawlers (GPTBot, ClaudeBot, Googlebot, curl, and more) or as campaign visits (Google ad, newsletter, Hacker News). Each click is a new visitor. This is how you fill the Bots and Acquisition sections.
5. **Recording playground:** change the page while recording, and check that the input, the `rr-block` region, and the sample secrets stay hidden. "Mask all text" switches to fully masked recordings.
6. **Event viewer:** every row moves from Queued to Sent (collector 200) to Stored (found in RawTree). Reads lag writes by a moment, so Stored can take a few seconds.

Everything you send goes to the database you're signed in to (or `RAWTREE_DATABASE` in env mode). Use a separate test database (same setup, another name) if you don't want test data next to real traffic: RawTree can't delete individual rows yet.

## 🎨 Customize it

**Branding.** The name, tagline, description, and docs/GitHub links live in [`lib/site.ts`](lib/site.ts). The images are `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png`, `app/opengraph-image.png`, `components/rawtree-logo.svg`, and `public/overview.jpg`. Colors and other design tokens are CSS variables in `app/globals.css`.

**Tune a widget.** Every dashboard query lives in [`lib/queries.ts`](lib/queries.ts), one documented template per widget. Edit the SQL there, for example add a channel host to `SEARCH_HOSTS` or change `ENGAGED_MS` (the dashboard's labels follow it). The SQL aliases are the field names the page reads.

**Add a widget.**

1. Write its SQL template in `lib/queries.ts`, reading `FROM ${events(s)}` and filtering with `inWindow(s)`. Follow the [query rules](#-ask-your-ai-agent).
2. If it counts events, add it to `EVENT_QUERIES`, so the dedup test checks it.
3. Add every column it reads that a young table may lack (for example `properties.plan`) to `OPTIONAL_COLUMNS`. A missing column then reads as NULL instead of failing the dashboard.
4. Run it in `getDashboard` in `lib/dashboard.ts`, with a row type that matches the aliases.
5. Render it in `app/(dashboard)/page.tsx`.
6. For a new section, also add its `id` to the `sections` list in `components/sidebar-nav.tsx`, so the sidebar links to it.

Date presets and the previous-period comparison live in `lib/range.ts`. Every day is a UTC day.

## 🤖 Ask your AI agent

Any AI agent or LLM client that speaks MCP can query your analytics through the [RawTree MCP server](https://rawtree.com/docs/reference/mcp). Follow the docs to connect your client of choice, and [use an API key](https://rawtree.com/docs/reference/mcp#hosted-mcp-with-an-api-key) instead of OAuth: give it the **read-only key** from the setup. OAuth grants broad access to your RawTree account, including destructive operations, while the read-only key can only read data.

These query rules make any number match the dashboard. Give them to your agent, and follow them in your own SQL:

- Tables: `events` (one row per event) and `recordings` (one row per recording chunk part). Their columns are listed in the [SDK README](packages/analytics/README.md#stored-tables).
- Delivery is at least once. Count with `uniqExact(toString(event_id))`, never `count()`, or deduplicate with `LIMIT 1 BY event_id` before aggregating values. Sessions are `uniqExact(toString(session_id))`, visitors are `uniqExact(toString(anonymous_id))`.
- Fields are dynamic JSON. Cast them: `toString(event_name)`, `CAST(occurred_at_ms AS Int64)`, `toString(properties.plan)`.
- Time is `occurred_at_ms` (epoch milliseconds, UTC). Always filter on an explicit window.
- Page views are `event_name = 'page_view'`, with `page_path`, `page_url`, and `referrer` on the row.
- Bots are told apart by `user_agent`. The dashboard's pattern is `BOT_UA_PATTERN` in [`lib/crawlers.ts`](lib/crawlers.ts).

For example, checkouts per plan:

```sql
SELECT toString(properties.plan) AS plan, uniqExact(toString(event_id)) AS checkouts
FROM events
WHERE toString(event_name) = 'checkout_started'
  AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
GROUP BY plan
```

The [tracking recipes](examples/recipes/RECIPES.md) and [`lib/queries.ts`](lib/queries.ts) (every dashboard query) have more queries to borrow from.

## 🩺 Troubleshooting

**The collector rejects events.** `/api/collect` answers with a JSON `error`:

| Status | `error` | What to check |
| --- | --- | --- |
| 403 | `origin_not_allowed` | The page's origin isn't in `ANALYTICS_ALLOWED_ORIGINS`. It must match scheme, host, and port exactly (`www.` counts). Browsers report this as a CORS error. Requests with no `Origin` header (curl, a backend) need the server token instead |
| 401 | `invalid_token` | The request has an `Authorization` header, but `ANALYTICS_SERVER_TOKEN` is unset or different |
| 413 | `payload_too_large` | The body is over 1,000,000 bytes. The SDK keeps its batches under this |
| 400 | `invalid_request`, `invalid_json`, `invalid_body` | The batch failed validation or isn't UTF-8 JSON. The `message` says what's wrong |
| 500 | `collector_not_configured` | `RAWTREE_DATABASE`, `RAWTREE_INGEST_KEY`, or `ANALYTICS_ALLOWED_ORIGINS` is missing |
| 503 | `storage_unavailable` | RawTree refused the insert. Check the server log: a wrong key, or a role-bound key whose tables don't exist yet |

**"All traffic" badge.** No event has stored a user agent yet, so bots can't be told apart. Browser events carry one automatically.

**Console stays on Sent.** RawTree reads lag writes by a moment. Stored usually appears within seconds, and the console gives up after 30 s.

**Role-bound keys.** Keys bound to database roles can't create tables. Create `events` and `recordings` first, or inserts fail with `503 storage_unavailable`.

## 🔒 Privacy notes

- Session recording masks all text and inputs by default. `maskAllText: false` shows page text while inputs stay masked. Elements with `rr-block` are never recorded.
- Page URLs keep only allowlisted query parameters (by default `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`) and drop credentials and fragments.
- RawTree can't delete individual rows yet, so plan retention before collecting real users.

## 🛠️ Development

```sh
npm ci
npm run typecheck
npm test             # offline: builds the SDK, runs the SDK and app tests with RawTree mocked
npm run build        # SDK + Next.js
```

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) has the rules and the checks CI runs on every pull request. Vercel deploys a preview for each pull request and production from `main`.

| Path | What |
| --- | --- |
| `packages/analytics/` | The SDK. `src/protocol.ts` is the event contract for both the SDK and the collector |
| `app/`, `components/` | Dashboard, recordings, console, and the collector routes |
| `lib/` | Collector, RawTree client, sign-in access, dashboard SQL, crawler classifier, recording reassembly |
| `lib/site.ts` | Name, tagline, and links shown in the app |
| `examples/recipes/` | Tracking recipes (typechecked against the SDK) |
| `test/` | Collector, access, dashboard query, and recording reassembly tests |
| `AGENTS.md` | Notes for coding agents working in this repo |
| `.github/` | CI and release workflows, pull request template, and issue forms |

## 📄 License

[Apache-2.0](LICENSE)
