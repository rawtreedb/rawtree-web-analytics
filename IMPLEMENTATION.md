# RawTree Web Analytics implementation plan

Status: milestone 1 complete (local implementation, verified end to end against hosted RawTree). Next: milestone 2. Committed locally on `main` (not pushed, published, or deployed). Hosted RawTree database `web_analytics` (org `rawtree`, cluster `internal_projects`) has `events` (sorted by `event_name, occurred_at_ms`) and `recordings` tables holding example test data, with two database-scoped keys and the collector settings in the ignored `.env.local`. See [Milestone 1 results](#-milestone-1-sdk-and-collector-results) and [Milestone 0 storage proof results](#-milestone-0-storage-proof-results).
Last updated: 2026-10-08.

Repository name: **`rawtree-web-analytics`**. Proposed npm package: **`@rawtree/analytics`**, subject to namespace ownership and availability. The eventual remote repository URL is not yet established.

> Open-source analytics for websites and web apps, with session replay and an AI agent. Powered by RawTree, rrweb, and Eve.

## 🧭 Continue this plan in another session

1. Read this document and applicable `AGENTS.md` guidance. Inspect the current files and Git state before assuming a milestone is still pending.
2. Start with the first unfinished milestone. Resolve its open dependencies before building features that assume they work.
3. Keep changes small and independently verifiable. Preserve unrelated work. Do not scaffold every future feature upfront.
4. Verify the complete affected flow, update milestone checkboxes, and append a short session-ledger entry with evidence and remaining blockers.
5. Distinguish local implementation, committed changes, published packages, deployed code, and live verification. Completing one does not imply the others.
6. Ask before provisioning shared resources, writing to shared databases, changing access controls, deploying, publishing, or posting on the user's behalf. Commit, push, and create PRs only when requested. This plan is not authorization for those actions.

Suggested continuation prompt:

> Read IMPLEMENTATION.md and applicable AGENTS.md files. Inspect the current state and continue the first unfinished milestone. Keep the SDK generic, authentication optional, and the Eve agent small. Implement and verify the local work, update the plan and session ledger, and ask before actions affecting shared resources or publication.

This is a fresh project, not a migration of Treewatcher. Do not copy its private Git history, internal data, credentials, company-specific policies, or knowledge systems.

## 🎯 Product goal and agreed scope

Build an open-source starter that a developer can install, connect to RawTree, instrument in their own product, and extend with an LLM.

The first version provides:

- One deployable Next.js application with an analytics dashboard, recordings browser/player, and Eve chat.
- One framework-independent event SDK with `sendEvent` and `sendRecording` functions.
- RawTree as the analytics store and the proposed recording store, subject to the recording-storage proof below.
- rrweb for opt-in browser session recording and replay.
- A small Eve agent that queries the analytics and investigates recording data.
- Copyable, runnable tracking recipes rather than enforced event names or automatic instrumentation.
- Straightforward configuration, synthetic demo data, and documentation designed for humans and coding agents.
- A build-in-public story based on working milestones and measured results.

Start with one instrumented product and one analytics workspace per deployment. The SDK should work in different products, but the starter is not initially a hosted, multi-tenant analytics service. Browser recording applies to websites and web apps. Backend-generated business events are also in scope.

### Explicit non-goals

- No learnings, personal rules, persisted catalog, semantic search, embeddings, or feedback-maintenance system.
- No Slack channel, subagents, scheduled reports, public sharing links, or visual browser agent.
- No mandatory authentication provider, user-management database, team permissions, or private-per-user conversation guarantees.
- No automatic click capture, identity stitching, framework-specific SDK packages, or configurable storage/provider framework.
- No queue, separate collector service, Redis, or Neon database unless a demonstrated requirement makes it necessary.
- No claim of lossless browser collection, exactly-once ingestion, automatic privacy compliance, or complete visual understanding of recordings.

## 🧱 Architecture and repository layout

```text
Instrumented product
  @rawtree/analytics
  optional rrweb recorder
          |
          | event and recording batches
          v
Next.js collection endpoint -- insert-only credential --> RawTree
                                                           |
Dashboard, replay APIs, Eve -- read-only credential ---------+
```

Use one Next.js application at the repository root and one SDK package under `packages/analytics`. npm workspaces are sufficient. Do not introduce a monorepo task runner initially.

Proposed responsibilities, creating directories only when needed:

| Location | Responsibility |
| --- | --- |
| `app/`, `components/` | Dashboard, recordings, chat, and application routes |
| `lib/` | Server-side RawTree transport, query contracts, recording retrieval |
| `agent/` | Eve configuration, instructions, two tools, two small skills |
| `packages/analytics/` | Publishable SDK, transport envelope, batching, optional recorder integration |
| `examples/` | Copyable recipes and a runnable synthetic sample product |
| `docs/` | Setup, event contract, privacy, optional access protection, extension guide |

Use Tailwind and shadcn for the UI. Reuse suitable Treewatcher patterns only after checking licensing and removing internal assumptions. No runtime imports from Treewatcher or RawTree's private product application.

Vercel is the first supported deployment path. Eve can run alongside Next.js through its supported integration. Pin a tested Eve version and read its bundled documentation before implementing APIs. Do not promise other hosting targets before testing their runtime and durability requirements.

## 🔓 Optional authentication and public-access semantics

The dashboard must run without Auth0, Clerk, or another required authentication setup. The initial operator-login proposal was explicitly removed.

- The public demo uses synthetic analytics/recordings and example chat responses. It must not silently consume a live model budget.
- Connecting real RawTree credentials and enabling live Eve are explicit setup steps.
- Without access protection, anyone who can reach the deployment can read its available analytics, retrieve recordings, and use enabled agent endpoints. Document this prominently before the live-data setup instructions.
- The open starter does not promise private conversations. Eve session URLs are not an authorization mechanism.
- Provide a short optional-auth guide with the locations where developers can integrate their existing access checks. Do not implement several auth adapters or a new auth framework.
- Protection must cover dashboard query APIs, recording metadata and payload retrieval, and every exposed Eve create/read/stream/continue/control route. Protecting just page navigation is insufficient.
- The browser collection route is separate from dashboard access. It must remain reachable by the instrumented product when dashboard authentication is added.

Even an intentionally open deployment needs payload limits, request limits, and live-agent spending controls. Origin checks help reject unwanted browser traffic but are not authentication. A public ingestion identifier is not a secret or proof of a trusted producer.

## 🔌 RawTree connection and Vercel Connect decision

Use direct server-side RawTree HTTP calls for v1:

- A separate insert-only credential for event and recording ingestion.
- A separate read-only credential for dashboards, replay, and Eve.
- Fixed configured destinations. Browser payloads and model arguments cannot select credentials, URLs, clusters, or arbitrary write tables.
- Prefer database-role keys restricted to the required tables. Pre-create tables during setup because role-bound inserts do not auto-create them.
- Ordinary `read_only` and `write_only` permission keys apply across their cluster, not only their default database. Do not present a default database as an isolation boundary.
- Administrative credentials are for approved one-time setup only. Never retain them in the deployed application or expose them to the agent.

RawTree's hosted MCP server supports OAuth, making Vercel Connect a plausible future option. However, the inspected OAuth contract grants broad access, including destructive operations. An Eve MCP tool allowlist does not narrow the underlying credential, and a query tool can execute supported writes if its credential permits them.

Do not make Connect mandatory in v1. Revisit it when RawTree offers suitably restricted OAuth grants or when connecting each viewer's own RawTree account becomes an actual requirement. Recheck the current API before deciding. Connect would manage authorization, not transport browser analytics.

## 📦 SDK contract

Proposed API, not an already published package:

```ts
import { createAnalytics } from "@rawtree/analytics";

const analytics = createAnalytics({
  endpoint: "https://analytics.example.com/api/collect",
});

analytics.sendEvent("checkout_started", { plan: "pro" });

// Wire this callback into rrweb's emit option.
const emit = (rrwebEvent) => analytics.sendRecording(rrwebEvent);
```

`sendEvent(name, properties)` accepts product-defined event names and JSON properties. `sendRecording(event)` accepts emitted rrweb events and buffers them into bounded batches. It does not upload a whole session on every emission.

Standardize only the transport envelope: version, stable IDs, timestamps, session linkage, and recording ordering. Keep custom properties separate from reserved fields. Define units and timestamp encoding explicitly. Distinguish occurrence time from collector receipt time.

The SDK owns:

- Stable event IDs and recording batch IDs that remain unchanged across retries.
- Session and recording identifiers with documented behavior across navigation, reload, tabs, inactivity, login, logout, and consent changes.
- Bounded in-memory buffering, size-aware batching, bounded retries/backoff, and explicit error/drop behavior. Never allow an unbounded offline queue.
- Best-effort page-exit flushing. Browser termination and network failure can still lose data.
- Optional opaque user IDs, without collecting email or credentials by default.
- Explicit flush/stop behavior and integration with the application's consent lifecycle. Define whether pending data is discarded when consent is withdrawn.

Keep rrweb in an optional package entry point so event-only installations do not download it. A small `startRecording` helper should apply privacy defaults and use the same recording transport. Developers with an existing rrweb recorder can call `sendRecording` directly, but are responsible for masking before that call.

Support authoritative server-side events without importing browser globals. Reuse the event contract. Trusted server ingestion should use server-held credentials and must not treat client-provided identity or an `origin` property as verified evidence.

Do not settle every convenience function now. Finalize and test the smallest useful API during the SDK milestone.

## 📚 Tracking recipes, not mandatory event conventions

Provide these as runnable examples used by the sample product:

| Recipe | Required semantics |
| --- | --- |
| Page views | Initial load and client-side navigation without double-counting |
| Page exits | Best-effort lifecycle delivery, with limitations of visibility changes and termination explained |
| CTA clicks | Explicit handler, stable CTA identifier, and placement |
| Scroll percentage | Maximum scroll depth and once-per-page thresholds, including short pages and changing page height |
| Time on page | Visible/active time versus total elapsed time, with the chosen definition stated |
| Web vitals | Standard `web-vitals` library, metric IDs, units, and update semantics rather than counting every update as a new measurement |
| Signups | Confirmed account creation, not a submit-button click |
| Logins | Successful authentication, not a login-page visit, without tokens or credentials |
| Product events | Product-defined events such as `project_created`, `export_completed`, or feature usage |
| Backend events | Authoritative business outcomes emitted from trusted server code |

Each recipe includes a small implementation, example payload, trigger/measurement definition, cleanup, privacy and duplicate-delivery notes, and a RawTree query showing how to analyze it.

Installing the SDK does not activate these recipes automatically. Developers can change names, properties, or triggers. Dashboard cards dependent on example conventions must explain those dependencies and treat absent instrumentation as unavailable rather than zero.

## 🎬 Recording storage, retrieval, and privacy

Proposed initial logical tables:

| Table | Contents |
| --- | --- |
| `events` | Event ID, occurrence/receipt times, session ID, optional opaque user ID, event name, sanitized page context, custom properties, envelope version |
| `recordings` | Recording/session ID, stable chunk ID, emission sequence range, timestamps, format version, snapshot metadata, rrweb payload |

Derive the initial recordings list from chunk metadata instead of maintaining another mutable sessions table. The exact payload representation, compression, and sorting keys are outputs of the storage proof, not settled assumptions.

### Required transport and replay properties

- Preserve rrweb emission order, including events with identical timestamps and uploads arriving out of order.
- Every replayable segment needs its initial full snapshot. Preserve snapshot dependencies when chunking, paging, expiring, or deleting recordings.
- Split requests below the smallest applicable browser, hosting, collector, and RawTree limit. RawTree's body limit alone does not establish the usable batch size. Test a single large snapshot explicitly.
- Reuse IDs on retry. Deduplicate in analytics and replay retrieval where needed. Do not assume RawTree provides unique constraints or indefinite insert deduplication.
- Acknowledge only after RawTree accepts the data under a verified ingestion contract. No fire-and-forget collector acknowledgement that can silently lose the batch.
- Surface missing chunks and unsupported content as incomplete coverage. Do not fabricate a continuous replay.
- Fetch large recordings in bounded segments rather than load unbounded payloads into memory or model context.
- rrweb records DOM changes and interactions, not video. External assets can disappear or require authorization. Document the initial limits around media, canvas, and cross-origin content.

### Privacy and lifecycle

- Recording is opt-in and starts only when the integrating application allows it. The template is not a consent-management product.
- Default to masked inputs and text, block explicitly private regions, sanitize sensitive URL data, and leave canvas/network/console capture off.
- Review DOM attributes, links, images, and custom event properties as potential sensitive data. Masking inputs alone is insufficient.
- Verify stored payloads with synthetic sensitive sentinels, not just screenshots of masked replay.
- Treat recorded DOM and event properties as untrusted input. Use rrweb's supported replay isolation and test that playback cannot execute captured application scripts or escape into the dashboard.
- Define retention and deletion for payloads, metadata, snapshots, chat/tool traces, and any retained copies. Do not send full replay payloads to the model or logs by default.

**Deferred by the user (2026-10-07):** retention and deletion are out of scope for now. The current RawTree public API has no row deletion or TTL (see milestone 0 results). Revisit before collecting real users. Do not claim retention or deletion guarantees in docs or UI while this is deferred.

## 🤖 Minimal Eve agent

Use one agent with a short instructions file, current-time context, two authored tools, and two small static skills. Skills are versioned instructions, not a persisted catalog.

| Tool | Responsibility |
| --- | --- |
| `analytics_query` | Agent-written bounded read-only SQL and supported live schema inspection against the configured analytics data |
| `recording_read` | Read a bounded recording interval and return an ordered interaction timeline with evidence and replay timestamps |

| Skill | Contents |
| --- | --- |
| Querying product analytics | RawTree SQL/Dynamic-field syntax, event/session semantics, deduplication, exact time windows, funnels, retention queries, and missing-data caveats |
| Investigating recordings | Correlate events and recordings, inspect interactions, distinguish evidence from interpretation, and cite replay timestamps |

Disable unnecessary default shell, filesystem, web, and external-action tools. Keep skill loading available through the chosen Eve version's supported configuration. Do not add sandbox-dependent behavior just to load text instructions.

Carry forward the useful Treewatcher query boundaries: fixed routing, read-only credentials, one allowed read statement, blocked external-access functions, harness-managed settings/format, bounded runtime/resources/results, and errors the model can use to correct SQL. Credentials, not prompt instructions, enforce permissions. Redaction is defense in depth, not a guarantee against sensitive producer content.

The query tool should return useful provenance, returned row count, truncation, and query statistics. The agent should cite sources, define its time window, and prefer a small number of queries for simple questions. Set modest live-agent execution/spending limits rather than copying Treewatcher's internal budgets.

The recording tool should resolve available interaction targets from snapshots/mutations and return a bounded timeline rather than dump the rrweb stream. It must retain privacy masking and explain absent labels or missing chunks.

An answer can say “three clicks followed by no navigation.” It should not infer “the user was confused” as a fact. The agent does not initially visually watch recordings. A future rendering/vision capability would be a separate feature.

Use Vercel AI Gateway through the project's supported credentials by default. Keep the model configurable. Let Eve own conversation durability within its documented retention. Do not add another database solely to duplicate transcripts.

## 🖥️ Application experience

Initial screens:

1. **Overview:** date range, event volume, active anonymous IDs/sessions, top events, and pages where page-view instrumentation exists. Explain metric definitions and coverage.
2. **Recordings:** filterable session/recording list, replay player, event timeline, incomplete-recording state, and timestamp links.
3. **Ask:** Eve chat with tool progress, source references, SQL evidence, and links to relevant replay intervals.

Reuse the same data definitions in dashboard queries, recipes, and agent instructions. Avoid a separate semantic-model service. Custom product events must remain queryable even when no predefined dashboard card uses them.

Milestone 2 builds only the Overview and a simple Recordings list and player (see the milestone for the trimmed scope). Synthetic demo mode is deferred. If it comes back, keep it clearly labeled and never mix synthetic rows into production metrics. Live-agent activation must be explicit rather than a side effect of opening the public demo.

## ⚙️ Setup, maintenance, and LLM-friendly documentation

Keep required configuration limited to RawTree connection/database, separate ingestion/query keys, and allowed product origins. Live AI configuration depends on the supported Gateway deployment path. Authentication is optional. Final environment-variable names will be documented once implemented.

A clean setup should let someone:

1. Clone the template and run the synthetic demo.
2. Create the RawTree tables and restricted credentials using public instructions.
3. Configure the app, with an explicit public-exposure warning before enabling real data.
4. Install the SDK in their product and send a custom event.
5. Enable recording separately after privacy and retention configuration.
6. Enable Eve and optionally integrate their existing access protection.

Provide a connection check with useful errors. Never ask for an admin credential as a permanent workaround for missing grants. Use isolated test/preview datasets and credentials, not production defaults.

Repository documentation:

- `README.md`: setup, architecture, one event-to-query walkthrough, exposure warnings, supported deployment, and known limitations.
- `AGENTS.md`: exact commands, ownership boundaries, invariants, verification requirements, and where to extend behavior. Keep it short and repository-specific.
- Event contract: reserved fields, units, identity/session behavior, duplicate delivery, versioning, and compatibility.
- Runnable recipes and a synthetic sample product whose examples are checked against SDK types.
- Extension guide: add an event, dashboard metric, agent skill, or access check.
- Privacy/operations guide: consent integration, masking, retention/deletion, abuse controls, cost controls, and recording limitations.

Types and validation are the contract's source of truth. Do not maintain competing schemas or disconnected examples. Pin tested versions, use a lockfile, and add only CI checks that protect the shipped app/package. Check redistribution rights before copying code/assets and select the public license before release.

## 🚀 Build milestones and acceptance criteria

### 0. Establish the fresh project and prove storage

- [ ] Establish repository/package ownership and license choices. Initialize/scaffold locally when implementation begins. No remote creation or publication without authorization. *Local scaffold done. License: Apache-2.0, matching `rawtreedb/jev-pr-quality` (`LICENSE` copied verbatim, "Copyright 2026 Tinybird, S.L."). Remaining: `@rawtree` npm publishing access before release.*
- [x] Verify the current RawTree ingestion/query contracts and narrow credential grants on an approved disposable dataset. *Contracts verified from source, public docs, and the production OpenAPI spec. Database-scoped grants verified live on `web_analytics` (see results).*
- [x] Round-trip asymmetric synthetic events and a realistic rrweb recording without payload corruption. *Recordings byte-identical locally and on hosted RawTree. Event properties lose `null`/`{}` and ISO datetime strings are reformatted: carry into the event contract.*
- [x] Test duplicate batches, out-of-order arrival, equal timestamps, missing chunks, and a large full snapshot. *Passed locally and on hosted RawTree (2026-10-07).*
- [x] Measure recording size, ingestion behavior, query/retrieval latency, and the smallest relevant payload limit. *Measured on hosted RawTree, including read-after-write lag. RawTree's own 50/100 MiB body limit was not probed; it is far above the binding 4.5 MB and 64 KiB limits.*
- [ ] ~~Resolve retention/deletion before real-user recording.~~ **Deferred by the user (2026-10-07).** The public API has no row deletion or TTL. Not part of milestone 0 acceptance for now.

Acceptance: a supported recording representation and retrieval path are demonstrated with evidence. Unsupported privacy/lifecycle guarantees are not papered over. Storage alternatives require an explicit decision rather than an unplanned abstraction.

### 1. Implement the SDK and collector

- [x] Implement the generic event envelope, `sendEvent`, `sendRecording`, session rules, batching, and bounded retries.
- [x] Keep optional recording code out of event-only bundles and browser globals out of server event usage.
- [x] Validate collector payloads, fix destinations, apply request/size limits, and keep secrets server-side. *Request-rate and abuse limits are not implemented. They must be chosen before exposing live collection (see decisions).*
- [x] Install the packed SDK into a separate sample consumer so workspace imports cannot conceal packaging errors.
- [x] Add the event recipes and their analysis queries alongside the working sample product.

Acceptance: browser and trusted-server events reach RawTree through their documented paths. Retries do not inflate reported counts. Collector failures, rejected/oversized data, consent withdrawal, and page lifecycle boundaries have targeted tests. No live package publication yet.

### 2. Build the dashboard and replay experience

Two pages in the existing Next.js app, queried server-side with the read-only `RAWTREE_QUERY_KEY`. Style them with Tailwind and the rawtree-platform design tokens, like the test console.

- [x] **Overview:** a date range picker (24h/7d/30d presets plus explicit UTC dates), then event count, sessions, anonymous IDs, top events, and top pages (from `page_view`). Every query counts each event once (`uniqExact(toString(event_id))`). The SQL lives in `lib/dashboard.ts` so the recipes and the agent can reuse it.
- [x] **Recordings:** a list built from the `recordings` table (session, start time, duration, complete or incomplete) and an rrweb player. The reassembly from the milestone 0 commit (`scripts/storage-proof/format.ts`) moved into `lib/reassembly.ts` (JSON payloads only). Recordings with missing parts or chunks are marked incomplete and only complete stretches replay. The player fetches payloads in bounded parts (metadata first, then the `planFetch` chunk range, ≤ 2 MB). List completeness is aggregated in SQL (`uniqExact(chunk_id)` vs declared parts); very recent incomplete recordings show "Still arriving" because reads lag writes.
- [x] **Tests, only where regressions are likely:** reassembly (`test/reassembly.test.ts`: shuffled order, duplicate parts, conflicting duplicates, a missing part, missing chunks, `planFetch` bounds; rows built with the SDK chunker) and the deduplicated counts (`test/dashboard-counts.test.ts`: counting SQL must use `uniqExact(event_id)` and never `count()`, row extraction, recording completeness, range resolution).

Acceptance: send a known set of events and one recording from the test console. The overview numbers match a hand count, a resent event doesn't change them, and the recording replays in the player. Check the populated and empty states in the browser. *Done 2026-10-08 (see ledger): 10 events + 1 recording sent from the console; overview matched an independent SQL hand count exactly, the resent `signup_completed` (same ID) counted once, the recording listed Complete and replayed; populated overview, recordings list, player, incomplete-recording player, and empty overview verified from screenshots.*

**Follow-up (2026-10-08, owner request):** the dashboard now mirrors Treewatcher's growth dashboard in a Treewatcher/Birdwatcher-style shell (RawTree logo, sidebar, sticky header with the date filter) with Overview, Traffic, Acquisition, Content, Engagement and Bots sections, built with recharts 3.10.1 (the Treewatcher pin). Bots: events carry an optional `user_agent` (SDK attaches the browser's, the collector falls back to the request header), classified by `lib/crawlers.ts`; human metrics exclude bots once user agents exist. SDK: per-event `pageUrl`/`referrer`/`userAgent` overrides and a recorder `maskAllText` option (default true; `false` keeps inputs masked but text readable). The console records readable text with denser mouse sampling by default and can send simulated bot and campaign visits. Owner-approved demo send done (see ledger). The date filter is Treewatcher's picker (presets + two-month UTC calendar; `@base-ui/react`, `react-day-picker`, `@tabler/icons-react`, `class-variance-authority`, `tailwind-merge` at Treewatcher's pins). The Bots section counts bot page requests (bot `page_view` events) like Treewatcher's.

Not in this milestone: synthetic demo mode, auth or access-denial checks, event-to-replay timestamp links, and mobile polish. The open-deployment warning moves to release.

### 3. Add the minimal Eve agent

- [ ] Implement the two tools and two skills with restricted runtime capabilities.
- [ ] Wire explicit live-agent activation, model configuration, resource limits, and tool provenance.
- [ ] Add fixture-backed evaluations for counts, comparisons, funnels, custom events, and recording investigation.
- [ ] Test missing evidence, duplicate events, exact date boundaries, malicious event/DOM text, forbidden SQL, and excessive-result handling.
- [ ] Verify the chosen Eve build/deployment contract, resumable chat behavior, and optional protection of all exposed routes.

Acceptance: answers reconcile with independently derived fixture results and link to the correct replay interval. The agent reports uncertainty and never presents a behavioral inference as observed intent. No knowledge system or extra application database has been added.

### 4. Prepare and release the starter

- [ ] Verify a clean install/build/test and fresh setup using only public documentation and no internal credentials.
- [ ] Review license, dependency notices, repository contents, examples, logs, and screenshots for internal information or secrets.
- [ ] Document supported versions, storage/cost measurements, limitations, lifecycle behavior, and optional auth integration.
- [ ] Explain what an open deployment exposes (dashboard data, recordings, the agent) and how to protect it.
- [ ] Publish the SDK, create/push the public repository, and deploy the demo only after the corresponding authorization.
- [ ] Verify the published package from a clean consumer and the deployed demo through the real browser/API/data flow.

Acceptance: someone outside the team can reproduce the documented setup. Record exact package/repository/deployment delivery state. Do not label local checks as a completed public release.

Release targets the owner set on 2026-10-08 (not yet authorized; do nothing until asked):

- **Dashboard + collector:** deployed publicly. The README's "Deploy the dashboard" section lists what that exposes (no login on dashboard or recordings, no collector rate limiting yet).
- **Test console:** local testing only. Never deploy it.
- **SDK:** `@rawtree/analytics` on the public npm registry for anyone to use. `packages/analytics/package.json` is ready (`npm publish --dry-run` passes). Still needed: an npm login with publish rights on the `@rawtree` scope, and a decision on making `rawtreedb/rawtree-web-analytics` public, since the npm page links to it. A published version can't be reused, so publish only after the owner reviews the SDK README.

## 🔬 Milestone 0 storage proof results

Session date: 2026-10-07. The proof ran locally with synthetic data. The only hosted writes were the `web_analytics` setup below and one row in a temporary `grant_check` table that was then dropped.

### Local project state

- `git init` on `main`, **no commits**. `/.amp/in/` is in `.git/info/exclude`. `.gitignore` covers `node_modules/` and env files.
- Root `package.json` (private, ESM, Node ≥ 24 running `.ts` directly via type stripping), `package-lock.json`, `tsconfig.json`. Pinned dev dependencies: `rrweb@2.1.7`, `playwright-core@1.63.0` (drives the system Chrome, no browser download), `typescript@7.0.2`, `@types/node@24.19.1`.
- No npm workspaces, `packages/analytics`, Next.js app, or Eve code yet. Those start in milestone 1.
- Proof code lived in `scripts/storage-proof/`. It was removed on 2026-10-08 and remains in the Git history (milestone 0 commit):

| File | Purpose |
| --- | --- |
| `format.ts` | **Candidate recording representation**: chunking, UTF-8-safe part splitting, read-time dedup, gap detection, replay segments, bounded fetch planning. Intended to move into the SDK (chunking) and `lib/` (retrieval) in milestones 1–2. |
| `format.test.ts` | Unit tests: equal timestamps, shuffled + duplicated rows, large snapshot parts (JSON and gzip), missing chunk/part, conflicting duplicates, fetch budget. |
| `record.ts` | Records two synthetic sessions in Chrome with rrweb and the proposed privacy defaults, including privacy sentinels. |
| `replay.ts` | Plays recordings with rrweb's `Replayer` and compares the final replayed DOM (tag counts, masked text length, scroll, viewport width) with the original page. |
| `targets.ts` | Two tiny clients with one interface: hosted RawTree HTTP API and a local ClickHouse server that mimics RawTree's `__raw_data` JSON rows. Proof-only, not a product storage abstraction. |
| `run.ts` | Round-trip scenarios, read-after-write lag probe, measurements, stored-sentinel scan, and a JSON report. Waits for acknowledged rows to become visible before checking them. With `--target rawtree` it writes only to temporary `proof_*` tables. |

Commands (generated fixtures, reports, and screenshots go to the ignored `.amp/in/`):

```sh
npm install
npm test && npm run typecheck
npm run proof:clickhouse          # local ClickHouse 24.10 on :18123, leave running
npm run proof:record              # synthetic rrweb fixtures in system Chrome
npm run proof:local               # round-trip through local ClickHouse emulation
npm run proof:replay              # replay fixtures and round-tripped events
# Hosted round trip (writes shared data: get approval first). Uses the keys in .env.local and temporary
# proof_events / proof_recordings / proof_recordings_gzip tables in web_analytics
# (run.ts never writes the real events/recordings tables for --target rawtree):
for t in proof_events proof_recordings proof_recordings_gzip; do
  rtree query --database web_analytics "CREATE TABLE $t ENGINE = ReplicatedRawMergeTree"; done
set -a; . ./.env.local; set +a; npm run proof:rawtree && npm run proof:replay
# Then drop the proof_* tables (admin: DELETE /v1/tables/<table>?database=web_analytics).
```

### Candidate recording representation

One row per chunk part in a `recordings` table, created with `ENGINE = ReplicatedRawMergeTree ORDER BY (recording_id, chunk_seq, part_index)`:

- Envelope fields on every row: `format_version`, `recording_id`, `session_id`, `chunk_id` (`<recording>:<chunk_seq>:<part>`, stable across retries), `chunk_seq`, `part_index`, `part_count`, `event_seq_start`/`event_seq_end` (rrweb emission indexes), `event_count`, `first_timestamp`/`last_timestamp` (rrweb ms), `has_meta`, `has_full_snapshot`, `payload_encoding`, `chunk_bytes`, `payload_bytes`, `payload`.
- `payload` is a **string** holding the chunk's rrweb event array as JSON (or a slice of it). Storing rrweb events as nested JSON fields would explode dynamic paths and hit JSON depth limits on deep DOMs.
- A new chunk always starts at an rrweb Meta event, and the following FullSnapshot stays in that chunk. Replay can therefore start at any `has_meta AND has_full_snapshot` chunk.
- Chunks over the part limit are split into UTF-8-safe byte parts, each sent and stored as its own row. A 6.5 MiB full snapshot becomes 7 rows of ≤ 1 MiB payload.
- Readers deduplicate with `ORDER BY chunk_seq, part_index LIMIT 1 BY chunk_seq, part_index` and order by sequence, never by timestamp. Missing chunks, missing parts, broken event sequences, and incremental data without a preceding snapshot are reported as gaps and unreplayable ranges.
- Metadata queries exclude `payload`. Replay of a time window fetches only the chunk range from the latest snapshot at or before the window start, within a byte budget.
- Queries use bare field names with explicit casts (`CAST(chunk_seq AS UInt32)`, `toString(recording_id)`). `toUInt32()` on Dynamic values fails on ClickHouse 24.10; `CAST` works.

**Decision (confirmed on hosted RawTree):** use `payload_encoding = "json"`. On RawTree, plain JSON payloads took ≈ 0.045 bytes on disk per raw byte vs ≈ 0.039 for gzip+base64, only ~13% more. Plain JSON keeps SQL inspection (sentinel audits, agent timeline extraction without decoding) and avoids a decode step. Compress on the browser→collector hop instead. `format.ts` keeps gzip support only for the proof. Drop it when the code moves into the SDK.

### Evidence (local)

- `npm test`: 9/9 pass. `npm run typecheck`: clean.
- `npm run proof:local` (report: `.amp/in/artifacts/storage-proof-clickhouse.json`): all 9 expectations PASS.

| Scenario | Result |
| --- | --- |
| Clean interaction (63 events, 4 chunks) | Byte-identical event JSON after round trip |
| Shuffled order + 1/3 rows re-sent without dedup token | 6 rows stored, 4 unique, byte-identical after read-time dedup |
| All timestamps forced equal + shuffled | Emission order restored exactly from sequence fields |
| Missing middle chunk | Reported `missing_chunks 1..1`; replay split into 2 segments, no fabricated continuity |
| Large snapshot (one 6.5 MiB FullSnapshot event) | 7 parts + 1 chunk, byte-identical, max request 1.19 MB |
| Large snapshot missing part 2 | Reported `missing_parts [2]`, no replay segment produced |
| gzip+base64 variant | Byte-identical |
| Same row inserted twice with `insert_deduplication_token` | 1 row stored (storage-level dedup works, best effort) |
| Bounded fetch after mid-recording checkout | Fetched 142 KB of 286 KB, started at the checkout chunk, matched the original slice exactly |
| 600 asymmetric events + 60 duplicates in shuffled batches | 600 unique IDs, deduped counts exact per event name |

- `npm run proof:replay` (results: `.amp/in/artifacts/replay-results.json`, screenshots alongside): original fixtures and every round-tripped file (clean, shuffled+dup, large, large gzip) replay to the same final DOM as the original page: tag counts, masked text length, scroll position, viewport width. Visual check of `interaction-original.png` vs `interaction.clean.clickhouse.roundtrip-replay.png`: same layout, text and inputs masked, blocked panel replaced by a placeholder.
- Captured application `<script>` did not execute in the rrweb replay iframe (`__appScriptRan` absent).

### Measurements

| Recording | Events | Duration | JSON | gzip | Full snapshots |
| --- | --- | --- | --- | --- | --- |
| Interaction page (~1,000 elements) | 63 | 2.4 s | 286 KB | 17.7 KB | 2 × ~139 KB |
| Large page (~45,000 elements, 12k CSS rules) | 16 | 1.5 s | 6.8 MB | 391 KB | 1 × 6.8 MB |

- Full snapshots dominate size. Incremental events are small. Periodic checkouts are needed to recover after gaps, but each one costs a full snapshot. Choose a checkout interval in milestone 1 from these numbers.
- Local ClickHouse 24.10 (LZ4, JSON type) on disk: plain JSON payloads ≈ 0.107 bytes per raw byte; gzip+base64 ≈ 0.058. RawTree's engine and codecs are different. Re-measure there.
- Local latencies (single node, laptop, not representative): insert p50 7–14 ms per row request, metadata query ~11 ms, 6.8 MB payload fetch ~82 ms.
- JSON escaping inflates the request body ~14% over `payload_bytes` (1 MiB payload → 1.19 MB request). The SDK must bound **request** bytes, not payload bytes.

### Payload limits, smallest first

| Limit | Value | Source |
| --- | --- | --- |
| `fetch(..., { keepalive: true })` / `sendBeacon` in-flight body | 64 KiB | Fetch spec. Applies to page-exit flushes only |
| Vercel Function request body | 4.5 MB (413 `FUNCTION_PAYLOAD_TOO_LARGE`) | Vercel docs, checked 2026-10-07 |
| RawTree insert, per ClickHouse insert | Bodies over 16 MiB are split into several inserts (not atomic; dedup token gets a per-chunk suffix) | `backend/src/routes/tables.rs` |
| RawTree global request body layer | 50 MiB (`DefaultBodyLimit`, applied after gzip decompression) | `backend/src/main.rs`, `constants.rs`. Unverified live |
| RawTree documented insert limit | 100 MiB | `limits.rs`, `/v1/limits`. Likely shadowed by the 50 MiB layer. Unverified live |
| RawTree query | 128 KiB SQL, 100 MiB result, 30 s | `limits.rs` |
| RawTree rate limits | 1,000 insert req/s per table, 10,000 query req/s per database | `limits.rs` |

Proposed bounds: ≤ 1 MiB request bodies for normal uploads, ≤ 60 KiB for page-exit flushes, large snapshots always split into parts. A production collector should batch rows from many sessions per RawTree insert because of the per-table request rate.

### Hosted RawTree proof (2026-10-07, user-approved)

Ran `run.ts --target rawtree` against temporary `proof_events`, `proof_recordings`, and `proof_recordings_gzip` tables in `web_analytics`, using the keys in `.env.local`. The tables were dropped afterwards, and `events`/`recordings` stayed at 0 rows. Report: `.amp/in/artifacts/storage-proof-rawtree.json`.

- **All 9 expectations PASS** on the second run. Clean, shuffled+duplicated, and equal-timestamp recordings were byte-identical. A 6.8 MB snapshot in 7 parts was byte-identical, as was the gzip variant. The missing chunk and missing part were reported. Bounded fetch matched the original slice. 600 unique event IDs from 660 delivered rows.
- `npm run proof:replay -- .amp/in/fixtures/*.rawtree.roundtrip.json`: all 4 RawTree round-trip files replay to the original final DOM. The captured script did not execute.
- The **first run failed 2 expectations** because reads ran immediately after acknowledged inserts. A re-query minutes later found every row (660 events, all chunks). Nothing was lost, but rows are not immediately visible. `run.ts` now polls for visibility before checking.
- **Read-after-write lag** (10 single-row probes): p50 332 ms, max 408 ms. A recording's rows were visible 120–380 ms after the last acknowledged insert.
- **Reads are not monotonic across replicas.** In one run, the count poll saw all 7 rows of a recording, but the next payload query still missed chunk 1, which appeared on later reads. The cluster has 2 replicas, and the session profile shows `insert_quorum = 0` and `select_sequential_consistency = 0`. Replay and the dashboard must treat very recent recordings as possibly still arriving, not as permanently incomplete.
- **Insert latency is ~0.9–1.7 s per request** (p50 ≈ 1.4 s), even for one small row. The session profile shows `async_insert = 1`, `wait_for_async_insert = 1`, and `async_insert_busy_timeout_max_ms = 1000`, so each acknowledged insert waits for an async flush. The ingest key's profile is not observable but likely the same. The collector should send few, larger batches and keep its acknowledgement path tolerant of ~1–2 s.
- **Storage-level dedup:** `replicated_deduplication_window = 10000` blocks, `replicated_deduplication_window_seconds = 3600`. Token dedup worked (2 sends, 1 row stored) but only within about an hour, so read-time dedup is mandatory.
- **Event property fidelity on RawMergeTree** (360 differences across 120 events, 3 kinds): `null` values dropped, `{}` dropped, and an ISO datetime string `"2026-10-07T10:00:00.123Z"` returned as `"2026-10-07 10:00:00.123000000"` (inferred DateTime64). Date-only strings, number-like strings, big-integer strings, mixed arrays, empty arrays, and Unicode round-tripped. Contract consequences: timestamps as epoch-ms numbers, and document that null and empty objects are not preserved in properties.
- **Storage** (`system.parts`, one replica): 27.97 MB of raw JSON payload → 1.25 MB on disk. 1.09 MB of gzip+base64 (≈ 14.2 MB raw JSON) → 0.56 MB on disk.
- **Hosted query latency** (from Madrid): metadata 130–210 ms, 286 KB payload 235–260 ms, 6.8 MB payload ~760 ms, 600-event raw read 262 ms, aggregate 121 ms.
- The privacy sentinel scan matched local results: attribute, link query, and page URL query present; input, password, masked text, and blocked region absent.

### RawTree contract findings (source, docs, production OpenAPI)

- `POST /v1/tables/{table}` accepts a JSON object or array and returns `{inserted}`. Production OpenAPI exposes `deduplicate_insert` (default `disable` for plain inserts) and `insert_deduplication_token`. Storage-level dedup is bounded by the engine's dedup window, so read-time dedup stays mandatory.
- `POST /v1/query` accepts read statements, `INSERT … SELECT`, `CREATE TABLE … ENGINE = ReplicatedRawMergeTree ORDER BY (…)`, `ALTER TABLE … MODIFY ORDER BY`, `CREATE ROLE`, `GRANT SELECT/INSERT`, and workload management. Nothing else.
- Database-role keys (`database_roles`) support `/v1/query`, `/v1/query/cancel`, and inserts into existing tables only. Role inserts do not auto-create tables.
- **Roles cannot be dropped through the public API.** A disposable setup leaves its roles on the cluster.
- The `internal` organization rejects database creation. The local `rtree` CLI is logged into org `rawtree`, cluster `internal_projects`, default database `treewatcher`: a shared environment. It was only read for status, never written.
- The local RawTree Compose stack cannot start here. `rawtree/rawtree-server:26.7.3` is not pullable without registry credentials, so local verification used vanilla ClickHouse 24.10 instead. RawMergeTree behavior is unverified.

### Hosted RawTree database (created 2026-10-07, user-approved)

- Organization `rawtree`, cluster `internal_projects`, database **`web_analytics`**. `SELECT currentDatabase()` returns `web_analytics`, so grants use the literal name on this cluster.
- Tables, both empty:
  - `events`: `ENGINE = ReplicatedRawMergeTree` with an automatic sorting key. Set an explicit key with `ALTER TABLE events MODIFY ORDER BY (…)` once milestone 1 fixes the event envelope.
  - `recordings`: `ORDER BY (recording_id, chunk_seq, part_index)`.
- Roles (created through `/v1/query`; they cannot be dropped through the public API):
  - `web_analytics_ingest`: `GRANT INSERT ON web_analytics.*`.
  - `web_analytics_query`: `GRANT SELECT ON web_analytics.*`.
  - Confirmed in `system.grants`. Database-level grants cover future tables in `web_analytics` and nothing outside it.
- Keys (database-role keys, no expiry, default database `web_analytics`):
  - `web-analytics-ingest` `d75a6009-b51f-4e2e-ba93-0b1e1df21014` → `RAWTREE_INGEST_KEY`.
  - `web-analytics-query` `5114b0ae-14c2-4a1c-9420-fa3d3dcd5209` → `RAWTREE_QUERY_KEY`.
  - Tokens live only in `.env.local` (mode 0600, Git-ignored). `.env.example` documents the variables.
- Created with the user's `rtree` session (CLI for the database, tables, roles, and grants; `POST /v1/keys` with `database_roles` for the keys, because `rtree key create` has no role option). No admin API key was created or stored.

Live permission checks. Write probes used a temporary `grant_check` table that was dropped afterwards, so `events` and `recordings` stay at 0 rows.

| Check | Result |
| --- | --- |
| Ingest key inserts into a `web_analytics` table | PASS, HTTP 200 `{"inserted":1}` |
| Query key reads `web_analytics` tables (`grant_check`, `events`, `recordings`) | PASS, HTTP 200 |
| Query key insert | Denied, HTTP 400 "Access denied" |
| Query key reads `treewatcher.traces` (via `?database=` and a qualified name) | Denied, HTTP 400 "Access denied" |
| Query key `INSERT … SELECT` | Denied, HTTP 403 (no write permission) |
| Query key `url()` table function | Denied, HTTP 400 |
| Ingest key query | Denied, HTTP 400 |
| Ingest key insert into a missing table | Rejected, HTTP 400 "Table … not found" (no auto-create) |
| Either key: list databases or create keys | Denied, HTTP 403 |

Not tested on purpose: ingest-key writes into other databases. They would target shared data, and `system.grants` shows INSERT only on `web_analytics.*`.

Contract notes from the live run:
- Grant denials on data calls return **HTTP 400** with `error: "rawtree_error"` and "Access denied", not 403. Management endpoints return 403. The collector must treat these 400s as non-retryable configuration errors.
- Table names must match `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`.
- `rtree database create` silently switches the CLI's default database. It was restored to `treewatcher`.

### Retention and deletion: deferred

Deferred by the user on 2026-10-07. For later: the public API has no row `DELETE`, lightweight delete, or `TTL`. `ALTER` accepts only `MODIFY ORDER BY`. Deletion is limited to admin-only table or database drops.

### Other findings to carry forward

- **Privacy defaults leak through attributes and URLs.** With `maskAllInputs`, `maskTextSelector: "*"`, and `blockClass`, the stored payload still contained: an email in a `data-*` attribute, a token in a link `href` query, and the page URL query (rrweb Meta `href`, URL-encoded). Typed input, password, masked text, and blocked-region sentinels were absent. Milestone 1/2 needs URL sanitization of Meta `href` and attribute/URL handling before `sendRecording`. Check the URL-encoded forms of sentinels too.
- **Local ClickHouse JSON type drops `null` values and empty objects** in event properties (240 differences across 120 events, all `null` or `{}`). Date-like strings, number-like strings, `"9007199254740993"`, mixed arrays, and Unicode round-tripped as text. Recheck on RawMergeTree before fixing the event contract.
- **rrweb Replayer quirks:** seeking with `pause(offset)` re-applies the latest Meta viewport size after later resizes, and live playback applies scroll smoothly (settles over a few hundred ms). The proof plays to the end and waits for scroll to settle. The dashboard player must account for both.

### Ownership facts

- npm scope `@rawtree` exists (`@rawtree/mcp@0.3.2`, maintainer `rmorehig`). `@rawtree/analytics` is unpublished. Publishing needs a scope owner to grant access.
- GitHub org `rawtreedb` exists. `rawtreedb/rawtree-web-analytics` does not.
- Treewatcher has no `LICENSE` file, so nothing can be assumed reusable under an open license.
- **License: Apache-2.0** (user decision, 2026-10-07), the same as `rawtreedb/jev-pr-quality`. `LICENSE` was copied verbatim ("Copyright 2026 Tinybird, S.L.") and `package.json` sets `"license": "Apache-2.0"`. Add the license to the SDK `package.json` in milestone 1.

### Next action (milestone 0, done)

1. **Start milestone 1.** *Done 2026-10-07: see milestone 1 results.*
   - Create `packages/analytics` (npm workspace, `"license": "Apache-2.0"`) with the event envelope, `sendEvent`, `sendRecording`, session rules, and bounded batching and retries. Move the `format.ts` chunking there with JSON payloads only.
   - Build the collector route with request bounds of ≤ 1 MiB normally and ≤ 60 KiB on page exit. Treat RawTree HTTP 400 "Access denied" as non-retryable.
   - Batch inserts to absorb the ~1.4 s insert latency.
   - Use epoch-ms timestamps and set the `events` sorting key once the envelope is fixed.
   - Sanitize the URLs and attributes that leaked in the sentinel test.
2. Retrieval code (`lib/`) must poll or tolerate read-after-write lag and non-monotonic replica reads, and label recent recordings as "still arriving".
3. Before release: `@rawtree` npm publishing access and the remote repository. Retention stays deferred.

## 🧩 Milestone 1 SDK and collector results

Session date: 2026-10-07. Local implementation only: nothing committed, published, or deployed.

### What exists

| Location | Contents |
| --- | --- |
| `packages/analytics/` | `@rawtree/analytics` 0.1.0 (npm workspace, Apache-2.0, ESM, built with `tsc` to `dist/`). Entry points: `.` (browser client), `./recorder` (rrweb, optional peer `^2.1.7`), `./server` (trusted backend events), `./protocol` (contract + validator). README documents the API and the event contract. |
| `app/api/collect/route.ts`, `lib/collect.ts`, `lib/rawtree.ts` | Next.js 16.4 collector: `POST` + CORS `OPTIONS`. No dashboard pages yet. |
| `examples/test-console/` | *Replaced on 2026-10-08 (originally `examples/sample-product/`, the "Acme Notes" fake site).* Vite + React + Tailwind 4 test console in the RawTree dashboard style: consent switches, buttons for browser and server events, a recording playground, and a viewer showing Queued → Sent → Stored per event. Installed from the packed tarball. `recipes/` holds the 10 recipe modules and `RECIPES.md` (verified queries) as reference code. |
| `test/collect.test.ts` | Collector unit tests. (`test/e2e/verify-rawtree.ts`, the read-only check of an end-to-end run, was removed on 2026-10-08 and remains in the Git history.) |
| `AGENTS.md`, `.env.example` | Commands, invariants, configuration. |

Commands: see `AGENTS.md`. Configuration: `RAWTREE_API_URL`, `RAWTREE_DATABASE`, `RAWTREE_INGEST_KEY`, `RAWTREE_QUERY_KEY` (unused by the collector until milestone 2), `ANALYTICS_ALLOWED_ORIGINS`, optional `ANALYTICS_SERVER_TOKEN` and `RAWTREE_TABLE_PREFIX`.

### Decisions made

- **Envelope v1** (`packages/analytics/src/protocol.ts`):
  - Reserved fields are kept separate from `properties`, and all times are epoch ms.
  - Rows store `occurred_at_ms`, `client_sent_at_ms`, and `received_at_ms`, plus `source` (`browser`/`server`) and the `sdk` version.
  - Page URLs are sanitized (no credentials or hash, only `utm_*` query parameters), and `page_path` is derived from them.
  - Properties lose `null` and `{}` before storage, so what is stored equals what was accepted.
- **Identity and sessions:**
  - `anonymous_id` and `session_id` live in localStorage and are shared across tabs. A new session starts after 30 minutes of inactivity.
  - `user_id` is in memory only. `reset()` is for logout; `stop()` is for consent withdrawal and discards unsent data and stored IDs.
  - `recording_id` is one per page load. `discardRecording()` drops unsent recording data when only recording consent is withdrawn.
  - Full rules are in the SDK README.
- **Transport:**
  - Requests use `text/plain` JSON, which avoids CORS preflights. One request is in flight at a time, capped at 1 MB.
  - The in-memory queue is bounded at 4 MiB and drops new items when full.
  - Retries cover network errors and 408/429/5xx with exponential backoff (max 5). Other 4xx responses drop the batch.
  - Page exit uses a keepalive flush (≤ 60 KB). While the page is hidden, anything queued later, for example by application listeners, gets its own keepalive flush.
- **Server events go through the collector** with `Authorization: Bearer <ANALYTICS_SERVER_TOKEN>`, not directly to RawTree. One validation path and one RawTree credential; product backends hold only the collector token.
- **Collector:**
  - **Producer checks:** exact-origin allowlist (or `*`) for browsers, or the server token. Requests with neither get 403.
  - **Limits:** 1 MB body, enforced on both declared and streamed size (413).
  - **Validation:** the shared validator; failures return 400.
  - **Storage:** events and recordings are inserted in parallel with a deterministic `insert_deduplication_token` (sha256 of the row IDs). The collector acknowledges 200 only after RawTree has accepted every row.
  - **Errors:** any RawTree failure, including permission errors, returns 503 and is logged, so clients retry with the same IDs. This differs from the milestone 0 note about non-retryable 400s: a misconfigured collector costs a few retries, then the SDK drops and reports the batch.
- **Recorder:** applies the privacy defaults and sanitizes every rrweb event, fixing the milestone 0 leaks:
  - Meta `href` keeps only allowlisted query parameters.
  - URL attributes lose their query string and hash.
  - Text-like attributes and any attribute value containing an email are masked.
  - After `reset()`/`discardRecording()` it skips events until a fresh full snapshot, so new recordings start replayable.
- **`events` sorting key:** `ORDER BY (event_name, occurred_at_ms)` set on the real table (empty) after testing it on `e2e_events`.
- **Recipe choices:**
  - Signups, logins, and exports are emitted by the backend with outcome-derived event IDs; the browser never duplicates them.
  - Web vitals use `web-vitals` 6.2.3, and analysis takes the latest value per `metric_id`.
  - A page view is a change of path or query string; hash-only changes don't count. See `RECIPES.md` for each definition.

### Evidence

- `npm test`: SDK 38/38 and root 25/25 (16 collector, 9 storage-proof). `npm run typecheck` clean. `npm run build` (SDK + Next) succeeds with TypeScript 7.0.2.
- **Mutation checks:** making every status non-retryable, or using the 1 MB limit for exit flushes, each made the SDK tests fail as expected.
- **Packed consumer** (`npm run sample:install`, now `npm run console:install`, then in the example): `tsc --noEmit` passes against the tarball types. The tarball contains only `dist`, README, LICENSE, and package.json.
- **Bundle sizes** (`npm run size`):

| Bundle | Minified | Gzip |
| --- | --- | --- |
| Event-only `createAnalytics` | 13.3 KB | 4.9 KB |
| Sample main bundle | 33.9 KB | 12.1 KB |
| Lazy recorder + rrweb chunk | 182 KB | 58 KB |

  rrweb is absent from the main and event-only bundles.
- **Smoke test** (`npm run smoke`, headless Chrome, mock collector): 39/39. It covers page views counted exactly, once-per-threshold scroll depth, time on page, keepalive page exit, web vitals, CTA clicks, backend-only signup/login/export with retries, logout reset, recording only after consent, masking sentinels absent, and nothing sent after withdrawal.
- **Live end to end** (user-approved temporary tables `e2e_events`/`e2e_recordings` in `web_analytics`, dropped afterwards; real collector via `next start` on :3100, because :3000 was taken by another local app):
  - **Smoke:** with `SMOKE_FORWARD_TO`, every request was also accepted by the real collector: 39/39.
  - **Stored events:** `test/e2e/verify-rawtree.ts` found all 40 accepted events stored, with 0 field mismatches (ignoring transport timestamps) and deduplicated counts per event name matching.
  - **Recordings:** both reassembled completely, starting with Meta + FullSnapshot, including the post-logout recording, which failed before the recorder fix. No masking sentinel was found in stored payloads.
  - **Retries:** the export whose acknowledgement was dropped and then retried is stored once. A server event sent twice with the same ID is also stored once (first write wins), thanks to RawTree token dedup.
  - **Live rejections:** a 1.2 MB body returned 413, a disallowed origin 403, a wrong token 401, and an empty batch 400. Preflight returned 204 for the allowed origin and 403 for others.
  - **Recipe queries:** all 10 `RECIPES.md` queries ran on RawTree and matched the runs (marked verified in the file).

### Known gaps and notes

- **No request-rate or abuse limiting yet** beyond the origin allowlist, server token, and size limits. Choose a mechanism (for example Vercel Firewall rate limiting) before exposing live collection.
- **No request compression.** Recording bodies are plain JSON (gzip would shrink them about 15×). Revisit if bandwidth matters. It would need `Content-Encoding` handling and a decompressed-size limit in the collector.
- **Clock skew is stored, not corrected.** Analyses can use `received_at_ms - client_sent_at_ms`.
- **Termination delivery was not tested in a real browser.** The smoke test simulates `visibilitychange`; real tab discard and bfcache restore are untested.
- **Example install after SDK changes:** a plain `npm install` in the example fails with `EINTEGRITY`. Use `npm run console:install`. The tarball is ignored by Git, so re-pack after cloning.
- **Reassembly is not in the working tree.** The proof scripts were removed on 2026-10-08. The proven `reassemble`/`planFetch` implementation is in the milestone 0 commit (`scripts/storage-proof/format.ts`).

### Next action

1. **Milestone 2: dashboard and replay**, with the trimmed scope in [the milestone](#2-build-the-dashboard-and-replay-experience): an Overview page and a Recordings list and player.
2. **Before exposing live collection:** choose request-rate limiting.
3. **Before release:** `@rawtree` npm publishing access and the remote repository. Retention stays deferred.

## 🧪 Verification rules

- Prefer small tests that distinguish plausible wrong implementations: duplicate IDs, different timestamps, exact boundaries, hidden/visible transitions, concurrent tabs, failed authentication outcomes, and missing snapshots.
- Derive expected metric values independently of the SQL/tool implementation under test.
- Use disposable synthetic data for writes, deletion, permission tests, and privacy sentinels. No production writes just to prove read-only enforcement.
- Verify browser collection through ingestion, stored payloads, query results, and replay. A successful HTTP response alone is insufficient.
- Inspect rendered screenshots for visual changes and exercise actual interaction flows. Never present generated UI concepts as verification.
- Measure the event-only bundle and test the packaged SDK outside the workspace before claiming it is installable.
- Verify model-facing tool availability, permissions, and output bounds through executed calls, not only prompts or tool descriptions.
- Record failures and unverified dependencies honestly. Keep review artifacts local and ignored. Do not commit sensitive traces or recordings.

## 📣 Build-in-public story

Use one synthetic sample product throughout the series. It should power documentation, event recipes, dashboard screenshots, recordings, and agent evaluations.

| Milestone | Public demonstration |
| --- | --- |
| Storage proof | The architecture and actual storage/privacy tradeoffs |
| SDK and collection | One event call becoming queryable data |
| Dashboard and replay | From an event to the interaction behind it |
| Eve | Ask a question, inspect the SQL, and open the evidence |
| Release | A fresh setup someone else can reproduce |

Progress: the series runs on the RawTree X account (@rawtreedb) as "Build your own product analytics on RawTree", in parts. Until the release it doesn't mention the project, repository, SDK, recordings, or rrweb. Part 1, "getting events in", is a draft in Zernio (2026-10-08). Part 2, "turning these queries into a dashboard", should follow milestone 2. Snippet outputs must come from real runs on an empty temporary database, rendered with `GET https://announcements.tinybird.co/api/code-snippet/rawtree` (source: `/Users/pabloabella/code/product-announcement-famework`). Follow `rawtree-platform/docs/marketing/brand/instructions.md`.

Each update should show one working result and one concrete lesson. Publish setup time, recording size, query latency, or model cost only after measuring them. Use synthetic data and reviewed screenshots. Draft social posts in the working thread and obtain consent before posting on the user's behalf. A broad content campaign is not a prerequisite for implementation.

## ❓ Decisions and risks to resolve as they become relevant

| Decision | Timing / current recommendation |
| --- | --- |
| RawTree recording retention and deletion | **Deferred by the user (2026-10-07).** No row delete or TTL in the public API. Revisit before real users |
| Recording representation, compression, chunk limits | **Decided (2026-10-07, hosted proof):** JSON-string payload chunks starting at Meta events, ≤ 1 MiB request parts, read-time dedup, sequence-based ordering |
| API-key role support and actual grants | **Verified 2026-10-07** on `web_analytics` with database-level role grants. Roles cannot be dropped through the API |
| Session lifecycle and retry/deduplication contract | **Decided (milestone 1):** documented in `packages/analytics/README.md` and enforced by `protocol.ts` and tests |
| Public live-data and live-agent exposure | Explain before activation. Auth remains optional; limits remain necessary |
| Hosting-level request/abuse limits | Still open. Size limits, origin allowlist, and server token exist; request-rate limiting does not. Choose before exposing live collection/inference |
| npm scope ownership, remote organization, license | License: Apache-2.0 (decided 2026-10-07). npm scope access and the remote repository: establish before release. Names are proposed, not claimed |
| Eve version/model/runtime retention | Select and verify during implementation, with documented limits |
| Connect integration | Deferred pending narrower OAuth or a real per-viewer connection requirement |

## 🔎 Planning references

Planning conversation: [RawTree Web Analytics plan](https://ampcode.com/threads/T-01a11639-2c20-72ac-a859-ee30761cf61f).

Existing local reference projects, not dependencies of the new app:

- Treewatcher: `/Users/pabloabella/code/rawtree/treewatcher`. Useful references include `agent/tools/tracking_query.ts`, `agent/lib/internal-sql.ts`, its UI patterns, and the installed Eve documentation. Its auth, catalog, learnings, Slack, and internal telemetry conventions are not template requirements.
- RawTree platform: `/Users/pabloabella/code/rawtree/rawtree-platform`. Inspect `web/content/docs/reference/authentication.mdx`, `web/content/docs/reference/api.mdx`, `web/content/docs/reference/mcp.mdx`, and the owning backend implementations when reconfirming capabilities.
- [Treewatcher query-tool development history](https://ampcode.com/threads/T-01a0f1f5-060a-7229-8814-07304accef19): useful lessons on fixed query routing, query bounds, clear errors, and excessive agent exploration.
- [rrweb storage guidance](https://rrweb.com/docs/library/storage) and [recorder configuration](https://rrweb.com/docs/guide).
- [Eve documentation](https://eve.dev/docs). The selected installed package's bundled docs are the implementation source of truth.

These references were inspected during planning. Recheck current contracts before implementation. Do not copy private reference content wholesale into public documentation.

## 📝 Session ledger

| Date | Work and evidence | Delivery state | Next action |
| --- | --- | --- | --- |
| 2026-10-07 | Consolidated the agreed architecture, optional-auth revision, generic SDK and recipes, minimal Eve scope, storage/privacy risks, milestones, and public-story plan. Inspected the target folder: empty, not a Git repository. | Plan document only. No scaffold, credentials, Git initialization, remote repository, data writes, or deployment. | Begin milestone 0 in a new implementation session. |
| 2026-10-07 | Milestone 0 started ([thread](https://ampcode.com/threads/T-01a11666-917a-754c-a23b-64c64065a84d)). Local scaffold and `scripts/storage-proof/`. Verified RawTree contracts from source, docs, and production OpenAPI. Recorded synthetic rrweb sessions in Chrome (286 KB interaction, 6.8 MB single-snapshot page). On local ClickHouse 24.10: byte-identical round trips with shuffled order, duplicates, equal timestamps, and a 7-part large snapshot. Missing chunks and parts were reported. Replays matched the original DOM. 9/9 unit tests, typecheck clean. Found the retention blocker (no row delete or TTL), privacy leaks via attributes and URLs, and that null/`{}` are dropped by the local JSON type. | Local only: Git initialized, nothing committed. No hosted RawTree writes, keys, roles, remote repository, publication, or deployment. Local RawTree stack unavailable (image needs registry access). | User: approve a hosted disposable run, choose a retention path, choose a license. Then run `rawtree-setup` → `proof:rawtree` → `proof:replay` → `teardown`. |
| 2026-10-07 | Per the user: created database `web_analytics` in `rawtree/internal_projects` with empty `events` and `recordings` tables, roles `web_analytics_ingest` (INSERT ON `web_analytics.*`) and `web_analytics_query` (SELECT ON `web_analytics.*`), and keys `web-analytics-ingest` and `web-analytics-query` in `.env.local`. Added `.env.example`. Verified grants live (allowed and denied cases; a temporary `grant_check` table was dropped). Retention deferred by the user. | Hosted: database, 2 tables, 2 roles, 2 keys. Local: `.env.local` (ignored) and `.env.example`, nothing committed. | Get approval for a hosted round trip in temporary `proof_*` tables. Choose a license. Then start milestone 1. |
| 2026-10-07 | License set to Apache-2.0, matching `rawtreedb/jev-pr-quality` (`LICENSE` copied verbatim, `package.json` license field). `run.ts --target rawtree` now writes only to temporary `proof_*` tables. Re-verified: typecheck clean, 9/9 tests, local proof 9/9 PASS. | Local files only, nothing committed. | Get approval for the hosted round trip in `proof_*` tables. Then start milestone 1. |
| 2026-10-07 | Hosted proof on temporary `proof_*` tables in `web_analytics` (dropped afterwards; real tables still 0 rows). First run: 2 failures caused by read-after-write lag. All rows were present on re-query. Added visibility polling and a lag probe; second run passed 9/9, and the RawTree round-trip files replay identically. Measured insert ~1.4 s/request (async insert with wait), lag p50 332 ms, non-monotonic replica reads, 1 h dedup window, JSON vs gzip storage (~13% difference). Found event-property coercions (null, `{}`, ISO datetime). Removed the unused `rawtree-setup.ts`. Local re-check: 9/9 tests, local proof 9/9. | Hosted: `web_analytics` unchanged apart from the dropped proof tables. Local: nothing committed. | Milestone 1: SDK and collector. |
| 2026-10-07 | Milestone 1: SDK (`packages/analytics`: client, recorder, server, protocol), Next.js 16.4 collector, sample product + 10 recipes (subagent, reviewed), SDK README and AGENTS.md. Fixed three SDK gaps found while verifying: exit flush missed late listener events, no recording-only discard, post-reset recording prefix without snapshot. Tests: SDK 38/38, root 25/25, smoke 39/39, packed consumer `tsc` OK, event-only bundle 4.9 KB gzip. Live end to end on temporary `e2e_*` tables (dropped): 40/40 events stored exactly, deduplicated counts match, recordings complete, all 10 recipe queries verified. Set the `events` sorting key. | Local only; nothing committed, published, or deployed. Hosted: `web_analytics.events` sorting key changed (table empty); temporary tables removed. `.env.local` gained the collector settings. | Milestone 2: dashboard and replay. Choose rate limiting before exposing live collection. |
| 2026-10-08 | At the owner's request, ran the project locally against the real tables. The collector runs with `next dev -p 3100` (`.env.local`, no table prefix; port 3000 is used by another local app). The sample product runs on :5173 with `PUBLIC_ANALYTICS_ENDPOINT`/`ANALYTICS_ENDPOINT` set to `http://localhost:3100/api/collect`. One automated Chrome visit (consent, pricing, signup, project, export, page hide) stored 24 browser events, `signup_completed` and `export_completed` from the server, and 1 recording in `web_analytics.events`/`recordings`. `next dev` appended its agent-rules block to AGENTS.md (kept). | Real tables now contain sample test data; RawTree cannot delete rows, so drop and recreate the tables before collecting real users. Nothing committed. | Milestone 2. |
| 2026-10-08 | Manual check in Chrome (DevTools MCP) against the real tables: after ticking consent, browser batches arrive at the collector with HTTP 200 and land in RawTree within ≤ 5 s (the flush interval). Server signup and export events and recording parts arrived too. The owner's earlier attempt sent nothing: consent starts unticked. In the first DevTools attempt both consent boxes became unticked after the first batch (which correctly stopped analytics); it did not reproduce, and the cause is unknown (the window may share a profile or have been clicked by hand). Sample changes: `/api/session` returns 200 `{}` when logged out instead of a confusing 401; added a one-line access log. Note: `npm run smoke` rebuilds the sample for :3000, so rebuild with `PUBLIC_ANALYTICS_ENDPOINT` before serving it to a collector on another port. | Local only; more sample test data in the real tables. | Milestone 2. |
| 2026-10-08 | At the owner's request, replaced the Acme Notes example with `examples/test-console/` (subagent build, reviewed). It is Vite + React 19 + Tailwind 4 with rawtree-platform's design tokens and trimmed button, badge, switch, card and table primitives (no Base UI), Geist fonts and Tabler icons. Its Node server provides `/api/config`, `/api/server-event` (server SDK with stable IDs) and `/api/stored` (read-only `RAWTREE_QUERY_KEY`), and auto-loads `.env.local`. Recipes moved to `examples/test-console/recipes/`. SDK: `sendEvent` now returns the event ID; the recorder ignores emits after stop (fixes a crash when only recording consent was withdrawn). Checks: SDK 38/38, root 25/25, console `tsc`, size (rrweb lazy; eager React app 90 KB gzip), smoke 34/34. Live in Chrome against the real tables: page_view, cta_click, project_created, feature_used, signup_completed (resent with the same ID, still 1 row) and a 21-part recording all reached Queued → Sent · 200 → Stored. | Local only; more test data in the real tables. The console runs on :5173 and the collector on :3100. | Milestone 2. |
| 2026-10-08 | At the owner's request: removed `scripts/storage-proof/` and `test/e2e/` (kept in the Git history), dropped the `proof:*` scripts and the proof compatibility test, and created the first local commits on `main`, one per piece: scaffold, storage proof, SDK, collector, test console, cleanup, docs. | Committed locally; not pushed. | Milestone 2. |
| 2026-10-08 | Build-in-public Part 1 ("getting events in", 6 posts). Each snippet was run on an empty temporary `thread_demo` database with a temporary key; both were deleted afterwards. Outputs are real, rendered with the announcements snippet API. Assets are in `.amp/in/artifacts/x-thread-part1/` (ignored). At the owner's request, connected the Zernio MCP and replaced the images in the existing @rawtreedb draft; the text, draft status, and schedule are unchanged. Added a Scope section to AGENTS.md (uncommitted). Trimmed milestone 2 to an Overview page and a Recordings list and player; the open-deployment warning moved to release. | Zernio draft updated, nothing posted. Repository: AGENTS.md and this file uncommitted. | Milestone 2. Then Part 2 of the thread from its real queries. |
| 2026-10-08 | Milestone 2: Overview (`/`: presets + custom date range, deduplicated event/session/anonymous-ID counts, top events, top pages) and Recordings (`/recordings` list + `/recordings/[id]` rrweb player) in the existing Next.js app, styled with the rawtree-platform tokens (Tailwind 4 + Geist). SQL centralized in `lib/dashboard.ts` (all counts `uniqExact(toString(event_id))`; list completeness aggregated in SQL); reassembly moved from the milestone 0 commit into `lib/reassembly.ts` (JSON payloads only); player fetches payloads in bounded parts via `/api/recordings/[id]`. Fixed the console's Vite build, which my root `postcss.config.mjs` broke (pinned an empty PostCSS config in `examples/test-console/vite.config.ts`). Tests: root 38/38 (new reassembly + dedup-count tests), SDK 34/34, typecheck clean, `next build` OK, console `tsc` + `size` OK (rrweb still lazy). Browser verification (playwright, real tables): sent 10 events + 1 recording from the console; overview matched an independent SQL hand count exactly (events, sessions, anonymous IDs, every top event); the resent `signup_completed` stored once and did not change the numbers; the recording listed Complete and replayed in the player; an incomplete 32k-chunk recording showed gaps, replayed only its first stretch; populated and empty states screenshot-verified. Dev server restarted on :3100 (the old one served pre-milestone-2 code); console still on :5173. | Local only; not committed, pushed, or deployed. Real `events`/`recordings` tables gained ~50 test events and 5 small recordings from the verification runs (owner-approved test data; RawTree cannot delete rows). | Milestone 3: the minimal Eve agent. Then Part 2 of the build-in-public thread from the dashboard's real queries. |
| 2026-10-08 | Milestone 2 follow-up ([Amp thread](https://ampcode.com/threads/T-01a11bf2-2c75-734f-95a1-00a2d222fc7f), continued in Claude Code with SDK, console and dashboard subagents): Treewatcher-style dashboard with six sections and shell; bots end to end (`user_agent` in protocol/SDK/collector, crawler classifier, bot section); SDK `pageUrl`/`referrer`/`userAgent` per-event overrides and recorder `maskAllText`; console readable recording, denser mouse sampling, bot and campaign presets. Fixed: an over-long browser UA would reject every event; the header UA was unbounded; `dailyTrendSql` failed on tables without a `user_agent` column. Checks: SDK 43/43, root 40/40, typecheck, `next build`, console `tsc` + build + size + smoke 38/38; dashboard screenshots at 1280 and 390 px against the real tables (reads only) plus a mock server for filled Acquisition/Bots. | Local only; nothing committed. No writes to RawTree yet: the real-table demo send was blocked pending owner approval. | Approve the demo send (adds `user_agent`/`referrer` columns and test rows to the real `events` table), then hand-count Bots/Acquisition and check the replay. Then milestone 3. |
| 2026-10-08 | Owner-approved demo send to the real tables through the test console (`.amp/in/demo-send.ts`, ignored): 2 events, 3 campaign visits, 10 bot presets, 1 recording with a scripted mouse glide; a second human-only run with a regular Chrome UA, because headless Chrome's own UA is (correctly) classified as a bot. Hand count matched the dashboard: 15 bot events (10 presets + 5 headless), crawlers and categories add up, acquisition Search 1 / Referral 1 / campaigns 2; replay shows readable text and the cursor moves through 13 positions. Dashboard: removed Top events (and its query), Daily breakdown sits beside the trend chart; Treewatcher date picker with its presets (`last_N_days` include today, unlike Treewatcher); Bots section rebuilt to Treewatcher's layout and page-request unit, with `xl` grid spans. Checks: SDK 43/43, root 40/40, typecheck, build, screenshots at 390/1280/2000 px. | Real `events` table gained `user_agent` and `referrer` columns and ~21 test rows plus 2 recordings. Nothing committed. | Newsletter visits (UTM, no referrer) land in Direct: decide whether `utm_medium` should drive the channel. Then milestone 3. |
| 2026-10-08 | Recordings redesign at the owner's request: `/recordings` opens the newest recording; `/recordings/[id]` shows the player on the left and a sidebar of the 50 most recent recordings (start, duration, session, size, status). Player: fixed resume after pause (rrweb `play()` without an offset restarts from 0; now resumes from `getCurrentTime()`), replay scaled to fit the stage, seek timeline with elapsed/total time, icon play/pause and restart, `PlaybackSpeed` pill control instead of a native select, segment pills for incomplete recordings. Checked in Chrome (playwright) at 1440 and 390 px: redirect, resume position kept (0:03 → 0:03), replay fits the stage, no horizontal overflow, sidebar navigation, speed state. Tests SDK 43/43, root 40/40, build OK. | Local only; nothing committed. | Milestone 3. |
| 2026-10-08 | Recordings view fills the viewport from `lg` (1024 px) up: list on the right from `lg`, only the list scrolls, the replay stage stretches to the remaining height. Below `lg` the list stacks under the player with normal page scroll. Checked at 1440×900 and 1024×768 (no page scroll, list scrolls) and 390×844. | Local only; nothing committed. | Milestone 3. |
| 2026-10-08 | Created the private GitHub repo `rawtreedb/rawtree-web-analytics` and pushed `main` (4 new commits). Wrote the root README: RawTree setup with `rtree` and role-bound keys, running locally, using the test console and dashboard, deploying the dashboard and what it exposes, adding the SDK. Prepared the SDK for npm (repository, homepage, keywords, public access; `npm publish --dry-run` OK). Owner set the release targets in milestone 4: public dashboard, local-only console, SDK on npm. | GitHub: private repo with `main` pushed. README and SDK metadata uncommitted. Nothing published or deployed. | Milestone 3. Publish and deploy only when the owner asks. |
