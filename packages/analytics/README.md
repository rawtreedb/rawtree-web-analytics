# @rawtree/analytics

Generic event and session-recording SDK for RawTree Web Analytics. Send product-defined events and rrweb recordings from the browser, plus authoritative events from your backend, to a RawTree Web Analytics collector.

The API may change before 1.0. The collector, the dashboard, and the setup live in the [main repository](https://github.com/rawtreedb/rawtree-web-analytics).

## Install

```sh
npm install @rawtree/analytics
npm install rrweb@^2.1.7   # only if you use session recording
```

## Browser events

```ts
import { createAnalytics } from "@rawtree/analytics";

// Create the client only after the user allows analytics.
const analytics = createAnalytics({ endpoint: "https://analytics.example.com/api/collect" });

const eventId = analytics.sendEvent("checkout_started", { plan: "pro" }); // undefined if dropped
analytics.setUserId("usr_123");   // after login: an opaque ID, never an email
analytics.reset();                // on logout
analytics.stop();                 // consent withdrawn
```

Page URL, referrer, and user agent come from the browser. Override them per event with `sendEvent(name, properties, { pageUrl, referrer, userAgent })`, for example to simulate crawlers or campaign visits in tests. Overrides are sanitized the same way, and `referrer: ""` means none.

Nothing is tracked automatically. Event names and properties are yours. See the [tracking recipes](https://github.com/rawtreedb/rawtree-web-analytics/blob/main/examples/recipes/RECIPES.md) for page views, CTA clicks, scroll depth, web vitals, signups, and more.

| Option | Default | Meaning |
| --- | --- | --- |
| `endpoint` | required | Collector URL |
| `userId` | none | Opaque signed-in user ID |
| `flushIntervalMs` | 5000 | Send interval. Open recording chunks close at each flush |
| `sessionTimeoutMs` | 30 min | Inactivity before a new session starts |
| `maxQueueBytes` | 4 MiB | Unsent data held in memory. New items are dropped when full |
| `maxRetries` | 5 | Retries per batch for network errors and HTTP 408/429/5xx |
| `allowedQueryParams` | `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | Query parameters kept in page URLs and referrers |
| `persistence` | `"local"` | `"local"` (localStorage) or `"memory"` |
| `maxChunkBytes` | 64 KiB | Size at which an open recording chunk closes |
| `onError` | none | Receives `invalid_event`, `queue_full`, `rejected`, `retries_exhausted` |
| `fetch` | `globalThis.fetch` | Custom fetch, mainly for tests |

## Session recording

```ts
// Start only after the user allows recording. The dynamic import keeps rrweb out of
// event-only bundles.
const { startRecording } = await import("@rawtree/analytics/recorder");
const stopRecording = startRecording(analytics);

// Recording consent withdrawn, analytics consent kept:
stopRecording();
analytics.discardRecording();
```

`startRecording` applies these defaults:
- Inputs and all text are masked. Pass `maskAllText: false` for readable text (inputs stay masked).
- Elements with class `rr-block` are blocked.
- Canvas, fonts, and inlined images are off.

It also sanitizes every event before queuing:
- Page URLs keep only allowlisted query parameters.
- URL attributes (`href`, `src`, `action`, …) lose their query string and hash.
- `title`, `alt`, `aria-label`, `aria-description`, and `placeholder` are masked.
- Any other attribute containing an email address is masked.

Besides `maskAllText`, two options are the recorder's own:

| Option | Default | Meaning |
| --- | --- | --- |
| `maskAttributes` | `title`, `alt`, `aria-label`, `aria-description`, `placeholder` | Attributes whose values are masked. Replaces the default list |
| `allowedQueryParams` | the five `utm_*` parameters above | Query parameters kept in recorded page URLs. Not inherited from `createAnalytics`: pass the same list to both if you change it |

Every other [rrweb record option](https://github.com/rrweb-io/rrweb/blob/master/guide.md#options) passes through and overrides the defaults: `maskAllInputs`, `maskTextSelector`, `maskTextClass`, `blockClass`, `blockSelector`, `sampling`, and so on. For example, readable text with sensitive regions masked, and a smoother cursor:

```ts
startRecording(analytics, {
  maskAllText: false,             // page text readable; inputs still masked
  maskTextSelector: ".private",   // mask text only inside these elements
  blockSelector: "[data-no-record]",
  sampling: { mousemove: 30, mousemoveCallback: 200 }, // ms between mouse samples / flushes
});
```

Review your DOM for other sensitive attributes. If you call `analytics.sendRecording(event)` with your own rrweb setup, masking is your responsibility. `sanitizeRecordingEvent` is exported to help.

rrweb records the DOM, not video. External assets can disappear, and cross-origin iframes, canvas, and media are not captured by default.

## Server events

```ts
import { createServerAnalytics } from "@rawtree/analytics/server";

const analytics = createServerAnalytics({
  endpoint: "https://analytics.example.com/api/collect",
  token: process.env.ANALYTICS_SERVER_TOKEN!,   // the collector's server token
});

await analytics.sendEvent("signup_completed", { plan: "pro" }, { eventId: `signup:${accountId}`, userId: accountId });
```

- No browser globals. Works in Node 20+, Bun, Deno, and edge runtimes.
- Events sent with the token are stored with `source = "server"`.
- `sendEvent` resolves after the collector stores the event and rejects otherwise.
- Pass a stable `eventId` derived from the business outcome so retries never double-count.

| Option | Default | Meaning |
| --- | --- | --- |
| `endpoint` | required | Collector URL |
| `token` | required | The collector's `ANALYTICS_SERVER_TOKEN` |
| `maxRetries` | 2 | Retries for network errors and HTTP 408/429/5xx |
| `timeoutMs` | 10 s | Timeout per attempt |
| `allowedQueryParams` | the five `utm_*` parameters | Query parameters kept in `pageUrl` |
| `fetch` | `globalThis.fetch` | Custom fetch, mainly for tests |

The third argument of `sendEvent` sets per-event context, all optional:

| Field | Meaning |
| --- | --- |
| `eventId` | Stable ID for idempotency, e.g. `signup:${accountId}`. Defaults to a random UUID per call |
| `occurredAt` | Epoch milliseconds or a `Date`. Defaults to now |
| `userId`, `anonymousId`, `sessionId` | Join the event to a user, browser, or session |
| `pageUrl` | Sanitized like in the browser: no credentials, no hash, only `allowedQueryParams` |
| `userAgent` | Stored as the event's user agent. Otherwise the collector uses the request's `User-Agent` header |

## Event contract (protocol v1)

Defined in [`src/protocol.ts`](src/protocol.ts). Its types and validator are the source of truth, and the collector uses the same validator.

**Units.** Timestamps are integer milliseconds since the Unix epoch (UTC). Sizes are UTF-8 bytes.

The stored columns are listed in [Stored tables](#stored-tables).

**Property notes.**
- `null` values and empty objects are removed before storage, because RawTree does not keep them.
- RawTree may reformat ISO datetime strings (`2026-10-07T10:00:00.123Z` is stored as `2026-10-07 10:00:00.123000000`). Send times as epoch-ms numbers.

**Delivery is at least once.** Retries reuse IDs, and the collector deduplicates identical retries for about an hour. Duplicates can still be stored, so always count with `uniqExact(event_id)` or deduplicate with `LIMIT 1 BY event_id`. Under one `event_id`, the first stored version wins within that window. After it, which duplicate a query returns is undefined.

**Compatibility.** New optional fields may be added in v1. Breaking changes bump `v`, and the collector rejects unknown versions with HTTP 400.

## Identity and sessions

- **`anonymous_id`:** random. Stored in localStorage, shared by tabs of the same origin, and kept across reloads and navigation. `reset()` rotates it and `stop()` deletes it.
- **`session_id`:** stored in localStorage with the last activity time and shared by tabs. A new session starts after `sessionTimeoutMs` without events or recording activity. Login (`setUserId`) keeps the session. `reset()` (call it on logout) starts a new one. `stop()` deletes it.
- **`user_id`:** in memory only. Set it again after each page load once you know the user.
- **`recording_id`:** one per client instance (page load). `reset()` and `discardRecording()` start a new one, and the recorder takes a fresh full snapshot.
- **No storage:** if localStorage is unavailable, IDs live in memory for the page.

## Delivery, limits, and failures

- **Batching:** batches are sent every `flushIntervalMs` with one request in flight.
- **Size limits:** requests are capped at 1 MB. Page-exit flushes use `fetch` keepalive and are capped at 60 KB. Data still queued when the page is discarded is lost.
- **Retries:** after a network error or HTTP 408/429/5xx, the batch is retried at the next flush once an exponential backoff has passed (1 s doubling up to 30 s, with jitter), for up to `maxRetries`. Other 4xx responses drop the batch and report `rejected`.
- **No offline storage:** the queue is bounded and in memory only.
- **Consent withdrawal:** `stop()` discards unsent data, deletes stored IDs, and ignores later calls. Data already sent is not recalled.

## Stored tables

The collector writes two tables in your RawTree database, from `EventRow` and `RecordingRow` in [`src/protocol.ts`](src/protocol.ts). RawTree stores every column as dynamic JSON, so cast fields in SQL. A column appears with the first row that carries it. To make your numbers match the dashboard, follow the [query rules](https://github.com/rawtreedb/rawtree-web-analytics/blob/main/README.md#-ask-your-ai-agent).

**`events`:** one row per event.

| Column | Meaning |
| --- | --- |
| `v` | Protocol version (`1`) |
| `event_id` | Generated by the SDK, or your server `eventId`. Stable across retries |
| `event_name` | 1–128 chars of `[A-Za-z0-9_.:-/ ]` |
| `occurred_at_ms` | When the event happened, client clock |
| `client_sent_at_ms` | Client clock when the request was sent. Use it with `received_at_ms` to estimate clock skew |
| `received_at_ms` | Collector clock |
| `source` | `browser`, or `server` for server-token requests |
| `sdk` | SDK name and version, e.g. `@rawtree/analytics@<version>` (`.../server` for the server SDK) |
| `session_id`, `anonymous_id` | See [identity rules](#identity-and-sessions) |
| `user_id` | Opaque, producer-supplied. For browser events this is a client claim, not verified identity |
| `page_url`, `referrer` | Sanitized, with no credentials, no hash, and only allowlisted query parameters |
| `page_path` | The path of `page_url`, set by the collector |
| `user_agent` | Sent by the SDK (up to 512 chars), or the request's `User-Agent` header when the event has none |
| `properties` | Your JSON, kept apart from reserved fields. Max 16 KiB, 6 levels deep |

**`recordings`:** one row per recording chunk part.

| Column | Meaning |
| --- | --- |
| `recording_id`, `session_id` | The recording (one per page load) and its session |
| `chunk_id` | `<recording_id>:<chunk_seq>:<part_index>`, set by the collector |
| `chunk_seq`, `part_index`, `part_count` | Chunk order, and this part's place in the chunk |
| `event_seq_start`, `event_seq_end`, `event_count` | The rrweb events in the chunk, by sequence number |
| `first_timestamp`, `last_timestamp` | rrweb timestamps of the chunk's first and last event |
| `has_meta`, `has_full_snapshot` | Whether the chunk starts a replayable stretch |
| `chunk_bytes`, `payload_bytes` | Size of the whole chunk and of this part's payload |
| `payload` | A slice of the chunk's rrweb event array, as JSON text |
| `payload_encoding`, `format_version` | `json` and `1` |
| `received_at_ms`, `source` | Collector clock, and `browser` or `server` |

## Recording format

Recordings are stored as chunk parts in the `recordings` table:
- A chunk starts at every rrweb Meta event and keeps the full snapshot that follows.
- Chunks close at `maxChunkBytes` (64 KiB) or at each flush.
- Each chunk's JSON is split into UTF-8-safe parts of at most 256 KiB, one row each.

Readers deduplicate by `(recording_id, chunk_seq, part_index)` and order by sequence, never by timestamp. Missing chunks are gaps; replay restarts at the next full snapshot.

## License

Apache-2.0
