# Tracking recipes

Ten small, runnable recipes. They are examples, not conventions the SDK requires: installing `@rawtree/analytics` activates none of them. Copy one, rename events and properties, or change the trigger to fit your product.

Start the browser recipes only after analytics consent. Each one is a function `(analytics, ...) => cleanup`; recipes that react to app outcomes (signups, logins, product events) take subscriptions from your app as plain callbacks. The cleanup only removes listeners and never sends anything. Server recipes take a `BackendEvents` helper (see [backend events](#10-backend-events)).

## Shared rules

**Stored rows.** The collector stores each event as one row in the RawTree `events` table with these fields: `v, event_id, event_name, occurred_at_ms, client_sent_at_ms, received_at_ms, source ("browser" | "server"), sdk, session_id, anonymous_id, user_id, page_url, page_path, referrer, user_agent, properties{...}`. Timestamps are epoch milliseconds. `page_url` keeps only allowlisted query parameters (utm_* by default) and no hash. `page_path` is derived from `page_url`.

**Page views.** Page views, exits, scroll depth, and time on page share one page-view state ([`navigation.ts`](navigation.ts)). Their events carry `properties.page_view_id` and `properties.path` (the page the measurement belongs to). Use `properties.path`, not `page_path`, for time on page: it is sent while navigating away, so `page_url` already shows the next page.

**Duplicates.** Delivery is at least once. A retried request can store the same `event_id` twice. Count with `uniqExact(toString(event_id))`, or deduplicate with `LIMIT 1 BY event_id` in a subquery before aggregating values.

**Queries.** RawTree is ClickHouse-based and stores events as dynamic JSON columns. The queries cast every field explicitly (`toString(event_name)`, `CAST(occurred_at_ms AS Int64)`, `CAST(properties.value AS Float64)`) and use an explicit 7-day window. They read the `events` table of your analytics database.

> ✅ Verified on 2026-10-07: every query below ran on hosted RawTree against data from two end-to-end runs of an example product (browser and backend → collector → RawTree), and the results matched the events each run sent.

| # | Recipe | Event | Source | File |
| --- | --- | --- | --- | --- |
| 1 | [Page views](#1-page-views) | `page_view` | browser | [page-views.ts](page-views.ts) |
| 2 | [Page exits](#2-page-exits) | `page_exit` | browser | [page-exit.ts](page-exit.ts) |
| 3 | [CTA clicks](#3-cta-clicks) | `cta_click` | browser | [cta-clicks.ts](cta-clicks.ts) |
| 4 | [Scroll depth](#4-scroll-depth) | `scroll_depth` | browser | [scroll-depth.ts](scroll-depth.ts) |
| 5 | [Time on page](#5-time-on-page) | `time_on_page` | browser | [time-on-page.ts](time-on-page.ts) |
| 6 | [Web vitals](#6-web-vitals) | `web_vital` | browser | [web-vitals.ts](web-vitals.ts) |
| 7 | [Signups](#7-signups) | `signup_completed` | server | [signups.ts](signups.ts) |
| 8 | [Logins](#8-logins) | `login_succeeded` | server | [logins.ts](logins.ts) |
| 9 | [Product events](#9-product-events) | `project_created`, `feature_used` | browser | [product-events.ts](product-events.ts) |
| 10 | [Backend events](#10-backend-events) | `export_completed` | server | [backend-events.ts](backend-events.ts) |

Two notes on `page_view` data follow the recipes: [bots](#bots) and [acquisition](#acquisition). Their queries are not covered by the verification above yet.

## 1. Page views

**Trigger.** One `page_view` for the page that is open when tracking starts (`navigation: "initial"`) and one for each client-side navigation that changes the path or query string: `history.pushState` (`"push"`), `history.replaceState` (`"replace"`), back/forward (`"pop"`), and a back/forward cache restore (`"pop"`). Pushing or replacing the same URL, hash-only changes, and state-only updates do not count. The query string only distinguishes page views in memory; it is not sent.

**Implementation.** [`page-views.ts`](page-views.ts) with [`navigation.ts`](navigation.ts), which wraps `pushState`/`replaceState` once and listens to `popstate` and `pageshow`.

```json
{
  "v": 1,
  "event_id": "7b5d9440-bb4f-4a8d-886f-7e9bdabf6d9d",
  "event_name": "page_view",
  "occurred_at_ms": 1791382844163,
  "client_sent_at_ms": 1791382844464,
  "received_at_ms": 1791382844472,
  "source": "browser",
  "sdk": "@rawtree/analytics@0.1.0",
  "session_id": "b1ead18f-201e-4187-89cb-06cd66bfefc0",
  "anonymous_id": "e064463e-aee3-42cc-8b75-5d8ef844539c",
  "page_url": "http://localhost:3001/",
  "page_path": "/",
  "properties": { "page_view_id": "aaebbe26-6d7b-4133-abc3-72649c3c86ac", "path": "/", "navigation": "initial" }
}
```

**Cleanup.** Unsubscribes. The last page-scoped recipe to unsubscribe restores the original `history` methods (unless another library wrapped them later).

**Privacy.** Path and navigation type only. The SDK strips non-allowlisted query parameters and the hash from `page_url` and `referrer`. Avoid putting personal data in paths (for example `/users/jane@example.com`).

**Duplicates.** A retry can store the same row twice; count `event_id`s. If your router calls `pushState` and then `replaceState` with a different URL for one logical navigation (redirects), you get two page views. Normalize redirects before they reach history, or filter them in queries.

```sql
-- Page views and unique visitors per path, last 7 days
SELECT
  toString(page_path) AS path,
  uniqExact(toString(event_id)) AS page_views,
  uniqExact(toString(anonymous_id)) AS visitors
FROM events
WHERE toString(event_name) = 'page_view'
  AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
GROUP BY path
ORDER BY page_views DESC
LIMIT 50
```

## 2. Page exits

**Trigger.** One `page_exit` per page view, the first time the document becomes hidden (`reason: "hidden"`) or fires `pagehide` (`reason: "pagehide"`). SPA navigations do not send it: they end a page view without leaving the page (time on page covers that).

**Best-effort limits.** Mobile browsers can kill a hidden page without `pagehide`. A crash, forced quit, or lost network sends nothing. The keepalive request can still fail and is limited to about 60 KB. A hidden tab that becomes visible again keeps the same page view, so "exit" means "the last moment we could reliably report", not "the user left". Treat exit counts as a lower bound.

**Implementation.** [`page-exit.ts`](page-exit.ts). Events queued while the page is hidden are sent by the SDK in a keepalive request.

```json
{
  "v": 1,
  "event_id": "20013bbb-addf-4ea4-a42e-8f570756c173",
  "event_name": "page_exit",
  "occurred_at_ms": 1791382848406,
  "client_sent_at_ms": 1791382848406,
  "received_at_ms": 1791382848410,
  "source": "browser",
  "sdk": "@rawtree/analytics@0.1.0",
  "session_id": "ee2a4536-f4b0-482e-8571-c1c04fd2bd94",
  "anonymous_id": "bb2bafdd-ef7b-4f2e-b62a-7382cec43491",
  "user_id": "acct_e3309d5159c7997018",
  "page_url": "http://localhost:3001/login",
  "page_path": "/login",
  "properties": { "page_view_id": "f18cdb4c-bff9-4b74-bdb3-f13e61c12250", "path": "/login", "reason": "hidden" }
}
```

**Cleanup.** Removes the visibility and pagehide listeners.

**Privacy.** Path and reason only.

**Duplicates.** At most one per `page_view_id` by construction; retries can still duplicate rows, so count distinct page views.

```sql
-- Pages where visits most often end, last 7 days
SELECT
  toString(properties.path) AS path,
  uniqExact(toString(properties.page_view_id)) AS exits,
  countIf(toString(properties.reason) = 'pagehide') AS pagehide_rows
FROM events
WHERE toString(event_name) = 'page_exit'
  AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
GROUP BY path
ORDER BY exits DESC
LIMIT 50
```

## 3. CTA clicks

**Trigger.** A click (mouse, touch, or keyboard activation) on an element marked with a stable ID and placement:

```html
<a href="/signup" data-cta-id="pricing_start_trial" data-cta-placement="pricing_table">Start trial</a>
```

One delegated listener sends `cta_click { cta_id, placement }`. It runs in the capture phase so it fires before the router navigates and `page_url` stays on the page where the click happened. Elements without `data-cta-id` are ignored; a missing placement becomes `"unknown"`.

**Implementation.** [`cta-clicks.ts`](cta-clicks.ts).

```json
{
  "v": 1,
  "event_id": "6a67dc1b-4fad-49f3-9f93-8498723f4d2b",
  "event_name": "cta_click",
  "occurred_at_ms": 1791382844589,
  "client_sent_at_ms": 1791382844764,
  "received_at_ms": 1791382844766,
  "source": "browser",
  "sdk": "@rawtree/analytics@0.1.0",
  "session_id": "b1ead18f-201e-4187-89cb-06cd66bfefc0",
  "anonymous_id": "e064463e-aee3-42cc-8b75-5d8ef844539c",
  "page_url": "http://localhost:3001/",
  "page_path": "/",
  "properties": { "cta_id": "nav_pricing", "placement": "header" }
}
```

**Cleanup.** Removes the delegated listener.

**Privacy.** Reads only the two data attributes, never element text, `href`, or form values.

**Duplicates.** Double clicks are two clicks by design. Count `event_id`s to ignore retried rows.

```sql
-- Clicks and clickers per CTA, last 7 days
SELECT
  toString(properties.cta_id) AS cta_id,
  toString(properties.placement) AS placement,
  uniqExact(toString(event_id)) AS clicks,
  uniqExact(toString(anonymous_id)) AS visitors
FROM events
WHERE toString(event_name) = 'cta_click'
  AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
GROUP BY cta_id, placement
ORDER BY clicks DESC
```

## 4. Scroll depth

**Measurement.** Depth = (`scrollY` + viewport height) / document height, in percent, tracked as the maximum reached during the page view. Each threshold (25, 50, 75, 100) is sent once per page view as `scroll_depth { threshold, scrollable }`. A page with nothing to scroll sends only `threshold: 100, scrollable: false`, once. Height changes (lazy content, accordions) are re-measured with a `ResizeObserver`, and a shrinking page can unlock the remaining thresholds. State resets on every new page view. Measurements are coalesced to one per animation frame.

**Implementation.** [`scroll-depth.ts`](scroll-depth.ts).

```json
{
  "v": 1,
  "event_id": "0c3f7e11-5d0e-4a51-9a3e-0e6a9b8f2c41",
  "event_name": "scroll_depth",
  "occurred_at_ms": 1791382845012,
  "client_sent_at_ms": 1791382845064,
  "received_at_ms": 1791382845070,
  "source": "browser",
  "sdk": "@rawtree/analytics@0.1.0",
  "session_id": "b1ead18f-201e-4187-89cb-06cd66bfefc0",
  "anonymous_id": "e064463e-aee3-42cc-8b75-5d8ef844539c",
  "page_url": "http://localhost:3001/pricing",
  "page_path": "/pricing",
  "properties": { "page_view_id": "5f0a1c9e-2b7d-4f3a-8c61-1d2e3f4a5b6c", "path": "/pricing", "threshold": 50, "scrollable": true }
}
```

**Cleanup.** Removes scroll/resize listeners, disconnects the observer, and cancels a pending frame.

**Privacy.** Numbers only.

**Duplicates.** Use the maximum threshold per `page_view_id`, which is unaffected by duplicate rows. Do not sum rows: one fast scroll sends several thresholds.

```sql
-- Share of page views reaching each depth, per path, last 7 days
SELECT
  path,
  count() AS page_views_with_scroll_data,
  round(countIf(max_threshold >= 25) / count(), 3) AS reached_25,
  round(countIf(max_threshold >= 50) / count(), 3) AS reached_50,
  round(countIf(max_threshold >= 75) / count(), 3) AS reached_75,
  round(countIf(max_threshold >= 100) / count(), 3) AS reached_100
FROM
(
  SELECT
    toString(properties.page_view_id) AS page_view_id,
    any(toString(properties.path)) AS path,
    max(CAST(properties.threshold AS Int64)) AS max_threshold
  FROM events
  WHERE toString(event_name) = 'scroll_depth'
    AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
  GROUP BY page_view_id
)
GROUP BY path
ORDER BY page_views_with_scroll_data DESC
```

## 5. Time on page

**Definition.** For one page view, `visible_ms` is the time the document was visible (`document.visibilityState === "visible"`), and `elapsed_ms` is wall-clock time since the page view started. For the initial page view, both start when tracking starts (after analytics consent), not at navigation start. "Visible" is not "active": an idle user looking at a visible tab still counts.

**Trigger.** One `time_on_page` when the page view ends: on the next SPA navigation, or the first time the page is hidden or fires `pagehide`. Time spent after returning to a previously hidden tab is not reported for that page view. That is the trade-off for sending once while the page is still alive.

**Implementation.** [`time-on-page.ts`](time-on-page.ts). Like page exits, it queues the event before the SDK's keepalive flush.

```json
{
  "v": 1,
  "event_id": "15541840-1822-4c44-9d2c-2a18d24d51e4",
  "event_name": "time_on_page",
  "occurred_at_ms": 1791382844590,
  "client_sent_at_ms": 1791382844764,
  "received_at_ms": 1791382844766,
  "source": "browser",
  "sdk": "@rawtree/analytics@0.1.0",
  "session_id": "b1ead18f-201e-4187-89cb-06cd66bfefc0",
  "anonymous_id": "e064463e-aee3-42cc-8b75-5d8ef844539c",
  "page_url": "http://localhost:3001/pricing",
  "page_path": "/pricing",
  "properties": { "page_view_id": "aaebbe26-6d7b-4133-abc3-72649c3c86ac", "path": "/", "visible_ms": 427, "elapsed_ms": 427 }
}
```

Note `page_path` is the next page (`/pricing`) while `properties.path` is the page that was measured (`/`).

**Cleanup.** Removes listeners. A page view that is still open when consent is withdrawn is not reported.

**Privacy.** Numbers and path only.

**Duplicates.** One per page view by construction. Deduplicate rows by `event_id` before taking quantiles. Page views that end with a killed tab have no row, so durations are biased toward completed views.

```sql
-- Median visible and elapsed seconds per path, last 7 days
SELECT
  path,
  count() AS page_views,
  round(quantileExact(0.5)(visible_ms) / 1000, 1) AS median_visible_s,
  round(quantileExact(0.5)(elapsed_ms) / 1000, 1) AS median_elapsed_s
FROM
(
  SELECT
    toString(event_id) AS id,
    toString(properties.path) AS path,
    CAST(properties.visible_ms AS Float64) AS visible_ms,
    CAST(properties.elapsed_ms AS Float64) AS elapsed_ms
  FROM events
  WHERE toString(event_name) = 'time_on_page'
    AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
  LIMIT 1 BY id
)
GROUP BY path
ORDER BY page_views DESC
```

## 6. Web vitals

**Measurement.** The standard [`web-vitals`](https://github.com/GoogleChrome/web-vitals) library (`onLCP`, `onCLS`, `onINP`, `onFCP`, `onTTFB`, default options). Each callback sends `web_vital { metric_name, metric_id, value, delta, rating, navigation_type }`. Units: milliseconds for LCP, INP, FCP, and TTFB; CLS is unitless. `rating` is `good`, `needs-improvement`, or `poor`.

**Update semantics.** One metric instance (`metric_id`) can be reported more than once as its value changes: CLS and INP grow, and LCP, CLS, and INP usually finalize when the page is hidden. A back/forward cache restore creates new metric IDs. So analysis keeps the latest value per `metric_id` and never counts rows as measurements. `delta` is the change since the previous report for the same ID.

**SPA caveat.** Vitals describe the hard navigation (page load). `page_url` is the URL when the value was reported, which may be a later client-side route.

**Implementation.** [`web-vitals.ts`](web-vitals.ts). `web-vitals` has no unsubscribe and must register only once per page, so callbacks register once and forward to the currently active client.

```json
{
  "v": 1,
  "event_id": "0d881c29-e28d-45dd-80e5-bf1db6e0cfd8",
  "event_name": "web_vital",
  "occurred_at_ms": 1791382848406,
  "client_sent_at_ms": 1791382848406,
  "received_at_ms": 1791382848410,
  "source": "browser",
  "sdk": "@rawtree/analytics@0.1.0",
  "session_id": "ee2a4536-f4b0-482e-8571-c1c04fd2bd94",
  "anonymous_id": "bb2bafdd-ef7b-4f2e-b62a-7382cec43491",
  "page_url": "http://localhost:3001/login",
  "page_path": "/login",
  "properties": {
    "metric_name": "CLS",
    "metric_id": "v5-1791382844166-6788921576284",
    "value": 0.10945953369140626,
    "delta": 0.10945953369140626,
    "rating": "needs-improvement",
    "navigation_type": "navigate"
  }
}
```

**Cleanup.** Detaches the client; the library callbacks stay registered but send nothing.

**Privacy.** Numbers and enums only. Attribution builds (`web-vitals/attribution`) add CSS selectors and URLs: review them before sending.

**Duplicates.** Retries and repeated reports share `metric_id`; `argMax` by occurrence time collapses both. If two reports share the same millisecond, `argMax` picks either; for CLS and INP, `max(value)` is an equivalent tie-safe choice because they only grow.

```sql
-- p75 per metric using the latest value of each metric instance, last 7 days
SELECT
  metric_name,
  count() AS measurements,
  round(quantileExact(0.75)(value), 3) AS p75,
  round(countIf(rating = 'good') / count(), 3) AS good_share
FROM
(
  SELECT
    toString(properties.metric_id) AS metric_id,
    any(toString(properties.metric_name)) AS metric_name,
    argMax(CAST(properties.value AS Float64), CAST(occurred_at_ms AS Int64)) AS value,
    argMax(toString(properties.rating), CAST(occurred_at_ms AS Int64)) AS rating
  FROM events
  WHERE toString(event_name) = 'web_vital'
    AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
  GROUP BY metric_id
)
GROUP BY metric_name
ORDER BY metric_name
```

## 7. Signups

**Trigger.** Confirmed account creation, not a submit-button click. The server emits the authoritative `signup_completed` right after the account is stored, with `eventId: "signup:<accountId>"` and `userId: accountId`. Validation errors and duplicate emails emit nothing. In the browser, only after the API confirms success, your app calls the `onAccountCreated` listener and the recipe calls `analytics.setUserId(accountId)`. The browser does **not** send `signup_completed`, so there is exactly one source.

**Implementation.** [`signups.ts`](signups.ts) (`trackSignups` in the browser, `emitSignupCompleted` on the server, called from your signup handler after the account is stored).

```json
{
  "v": 1,
  "event_id": "signup:acct_e3309d5159c7997018",
  "event_name": "signup_completed",
  "occurred_at_ms": 1791382847034,
  "client_sent_at_ms": 1791382847035,
  "received_at_ms": 1791382847065,
  "source": "server",
  "sdk": "@rawtree/analytics@0.1.0/server",
  "session_id": "b1ead18f-201e-4187-89cb-06cd66bfefc0",
  "anonymous_id": "e064463e-aee3-42cc-8b75-5d8ef844539c",
  "user_id": "acct_e3309d5159c7997018",
  "properties": { "plan": "pro", "method": "password" }
}
```

`anonymous_id` and `session_id` come from the browser client (for example in headers your SPA sends to its own API, only with analytics consent). They link the signup to the browser journey but are client-supplied, so treat them as untrusted linkage.

**Cleanup.** The browser cleanup unsubscribes the `onAccountCreated` listener.

**Privacy.** No email, password, or name. `user_id` is an opaque account ID. Decide in your consent policy whether server events are sent for users without analytics consent; one option is to send them without browser linkage in that case.

**Duplicates.** One account, one event ID: SDK retries and re-runs of the emitter never double-count when you count `event_id`s.

```sql
-- Confirmed signups per day and plan, last 7 days
SELECT
  toDate(fromUnixTimestamp64Milli(CAST(occurred_at_ms AS Int64))) AS day,
  toString(properties.plan) AS plan,
  uniqExact(toString(event_id)) AS signups
FROM events
WHERE toString(event_name) = 'signup_completed'
  AND toString(source) = 'server'
  AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
GROUP BY day, plan
ORDER BY day, plan
```

## 8. Logins

**Trigger.** Successful authentication, not a login-page visit or a submit click. The server emits `login_succeeded` only after verifying credentials, with `eventId: "login:<loginId>"`, where `loginId` is a public ID generated for that authentication (never the session token). Failed attempts emit nothing. In the browser, the recipe calls `setUserId(accountId)` after success (and when an existing session is found on page load), and `analytics.reset()` on logout, so the next person on the device gets a new anonymous ID, session, and recording.

**Implementation.** [`logins.ts`](logins.ts) (`trackLogins` with your app's `AuthSignals`, and `emitLoginSucceeded`, called from your login handler after the credentials were verified).

```json
{
  "v": 1,
  "event_id": "login:login_34ea8c11ae56378ada",
  "event_name": "login_succeeded",
  "occurred_at_ms": 1791382847838,
  "client_sent_at_ms": 1791382847838,
  "received_at_ms": 1791382847840,
  "source": "server",
  "sdk": "@rawtree/analytics@0.1.0/server",
  "session_id": "ee2a4536-f4b0-482e-8571-c1c04fd2bd94",
  "anonymous_id": "bb2bafdd-ef7b-4f2e-b62a-7382cec43491",
  "user_id": "acct_e3309d5159c7997018",
  "properties": { "method": "password" }
}
```

**Cleanup.** Unsubscribes the logged-in, session-restored, and logged-out listeners.

**Privacy.** No emails, passwords, tokens, or cookies. The browser keeps `user_id` in memory only.

**Duplicates.** Stable per login. Count `event_id`s; count `user_id`s for active users.

```sql
-- Logins and unique users per day, last 7 days
SELECT
  toDate(fromUnixTimestamp64Milli(CAST(occurred_at_ms AS Int64))) AS day,
  uniqExact(toString(event_id)) AS logins,
  uniqExact(toString(user_id)) AS users
FROM events
WHERE toString(event_name) = 'login_succeeded'
  AND toString(source) = 'server'
  AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
GROUP BY day
ORDER BY day
```

## 9. Product events

**Trigger.** Events your product defines. `project_created { project_id, template }` after the creation succeeded (not on the button click), and `feature_used { feature }` when a feature is actually used. Your app passes subscriptions to its outcomes (`ProductSignals`); the recipe turns them into events only while it runs, that is while analytics consent is granted.

**Implementation.** [`product-events.ts`](product-events.ts).

```json
{
  "v": 1,
  "event_id": "e9e64a02-73cf-430a-b79b-53ba2dcb4ba6",
  "event_name": "feature_used",
  "occurred_at_ms": 1791382847217,
  "client_sent_at_ms": 1791382847464,
  "received_at_ms": 1791382847466,
  "source": "browser",
  "sdk": "@rawtree/analytics@0.1.0",
  "session_id": "b1ead18f-201e-4187-89cb-06cd66bfefc0",
  "anonymous_id": "e064463e-aee3-42cc-8b75-5d8ef844539c",
  "user_id": "acct_e3309d5159c7997018",
  "page_url": "http://localhost:3001/app",
  "page_path": "/app",
  "properties": { "feature": "search" }
}
```

`project_created` looks the same with `"properties": { "project_id": "prj_1", "template": "blank" }`.

**Cleanup.** Unsubscribes both listeners.

**Privacy.** IDs and small enums only; never user-entered text such as project names or note content.

**Duplicates.** Browser events are at least once; count `event_id`s. Outcomes only the server can confirm (for example exports) belong in backend events.

```sql
-- Feature usage: uses and distinct users, last 7 days (project_created works the same way)
SELECT
  toString(properties.feature) AS feature,
  uniqExact(toString(event_id)) AS uses,
  uniqExact(toString(anonymous_id)) AS visitors
FROM events
WHERE toString(event_name) = 'feature_used'
  AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
GROUP BY feature
ORDER BY uses DESC
```

## 10. Backend events

**Trigger.** Authoritative business outcomes emitted from trusted server code with `createServerAnalytics` and a server-held token, so the collector stores them with `source = "server"`. Every call passes a stable, outcome-derived event ID such as `export:<exportId>`. The example is `export_completed`, emitted after an export finished.

**Implementation.** [`backend-events.ts`](backend-events.ts): `createBackendEvents({ endpoint, token })` returns `emit(name, properties, { eventId, ... })`, which never rejects and logs failures. Without `ANALYTICS_SERVER_TOKEN` it logs once and skips events. `emitExportCompleted` shows one outcome.

```json
{
  "v": 1,
  "event_id": "export:exp_7b43e01dfd717cf243",
  "event_name": "export_completed",
  "occurred_at_ms": 1791382847255,
  "client_sent_at_ms": 1791382847511,
  "received_at_ms": 1791382847513,
  "source": "server",
  "sdk": "@rawtree/analytics@0.1.0/server",
  "session_id": "b1ead18f-201e-4187-89cb-06cd66bfefc0",
  "anonymous_id": "e064463e-aee3-42cc-8b75-5d8ef844539c",
  "user_id": "acct_e3309d5159c7997018",
  "properties": { "format": "markdown" }
}
```

**Cleanup.** None: the server client holds no listeners or timers.

**Privacy.** Keep the token in server configuration only. The collector trusts the token, not any client-supplied identity: `anonymous_id`/`session_id` forwarded by the browser are linkage hints only.

**Duplicates and loss.** The server SDK retries network errors and HTTP 408/429/5xx with the same event ID. Emission is fire-and-forget after the business action: an analytics outage never fails the user's request, and an exhausted retry is logged and lost. When losing an outcome is unacceptable, write it to a durable outbox in the same transaction as the business change and deliver from there with the same event ID.

```sql
-- Server outcomes: stored rows vs distinct outcomes (duplicates from retries), last 7 days
SELECT
  toString(event_name) AS event,
  count() AS stored_rows,
  uniqExact(toString(event_id)) AS outcomes,
  stored_rows - outcomes AS duplicate_rows
FROM events
WHERE toString(source) = 'server'
  AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
GROUP BY event
ORDER BY outcomes DESC
```

## Bots

**Data.** Every browser event carries `user_agent` (the browser's `navigator.userAgent`). Server events take it from `context.userAgent`, and otherwise the collector uses the request's `User-Agent` header. Crawlers that run JavaScript (headless browsers, some AI fetchers) send page views like any visitor. The dashboard classifies them with `lib/crawlers.ts` (AI retrieval, AI training, search indexer, social preview, SEO tool, script or headless).

**Test console.** The *Simulated traffic* card sends one `page_view` per crawler preset with `sendEvent("page_view", properties, { userAgent })`. Each click is a new visitor: a throwaway `createAnalytics({ persistence: "memory" })` client, so bots get their own `anonymous_id` and `session_id` and never touch yours.

```sql
-- Page views by user agent, last 7 days (classify the result with lib/crawlers.ts)
SELECT
  toString(user_agent) AS ua,
  uniqExact(toString(event_id)) AS page_views
FROM events
WHERE toString(event_name) = 'page_view'
  AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
GROUP BY ua
ORDER BY page_views DESC
LIMIT 50
```

## Acquisition

**Data.** `referrer` is `document.referrer` and `page_url` keeps the `utm_*` parameters (the SDK's default `allowedQueryParams`; anything else is stripped). Attribute a visitor to the referrer and UTM values of their first page view.

**Test console.** The *Acquisition* buttons send a `page_view` as a new visitor on `/pricing?utm_source=...&utm_medium=...&utm_campaign=...` with a referrer (Google, none for the newsletter, Hacker News). The SDK reads both from the page, so the console swaps the URL (`history.replaceState`) and `document.referrer` only for the synchronous `sendEvent` call.

```sql
-- First-touch source per visitor, last 7 days
SELECT
  if(source = '', if(ref_host = '', '(direct)', ref_host), source) AS acquisition,
  count() AS visitors
FROM (
  SELECT
    toString(anonymous_id) AS visitor,
    argMin(extractURLParameter(toString(page_url), 'utm_source'), CAST(occurred_at_ms AS Int64)) AS source,
    argMin(domain(toString(referrer)), CAST(occurred_at_ms AS Int64)) AS ref_host
  FROM events
  WHERE toString(event_name) = 'page_view'
    AND CAST(occurred_at_ms AS Int64) >= toUnixTimestamp64Milli(now64() - INTERVAL 7 DAY)
  GROUP BY visitor
)
GROUP BY acquisition
ORDER BY visitors DESC
```
