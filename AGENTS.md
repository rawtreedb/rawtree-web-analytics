# rawtree-web-analytics

Read `README.md` for what the project does and how it's set up. Follow `CONTRIBUTING.md`: its guidelines are the project's rules, and every change must pass its three checks (`npm run typecheck`, `npm test`, `npm run build`; install with `npm ci`).

## Scope

Keep it simple. The project is only: an SDK to send events, examples, and a dashboard. AI agents query the data through the RawTree MCP; there is no in-app agent. Anything beyond that needs the owner's agreement first. Write tests that catch real regressions in those pieces, not tests for their own sake.

## Layout

- `packages/analytics/`: the publishable SDK (`@rawtree/analytics`). `src/protocol.ts` is the event contract; its types and validator are the source of truth for the SDK and the collector.
- `app/api/collect/route.ts` + `lib/collect.ts`, `lib/rawtree.ts`: the Next.js collector. It always writes with the env ingest key. `lib/access.ts` decides env mode vs sign-in mode for the dashboard and console.
- `lib/queries.ts`: every dashboard SQL query (one documented template per widget; aliases are the fields `app/(dashboard)/page.tsx` reads). `lib/dashboard.ts` runs them; pages import only `lib/dashboard.ts`. Bot detection lives in `lib/crawlers.ts`, date ranges in `lib/range.ts`, branding in `lib/site.ts`.
- `app/(dashboard)/console/` + `components/console/`: the test console page (`/console`). It sends through the workspace SDK to `app/api/console/collect` (same `handleCollect`, with the visitor's `access.ingest`); `app/api/console/server-event` runs the server SDK in-process and `app/api/console/stored` is the storage check (`access.query`). Both accept same-origin requests only and cap bodies at 64 KB.
- `examples/recipes/`: tracking recipes (`RECIPES.md` + `.ts` modules), typechecked by `npm run typecheck`.
- `test/`: collector, access, dashboard query, and recording reassembly tests. Every test mocks `fetch`, so none reaches RawTree.

## Agent notes

- Never run SQL or table names that come from a request. Credentials come from configuration or `lib/access.ts`.
- Delivery is at least once: deduplicate every count (`uniqExact(event_id)` or `LIMIT 1 BY`).
- Node ≥ 24 runs `.ts` directly: erasable syntax only and `.ts` extensions in relative imports.
- RawTree reads lag writes by about 0.1–0.4 s and replicas can disagree briefly. Poll, and never assume read-after-write.
- Write synthetic data to the real `events`/`recordings` tables only when the owner asks (since 2026-10-08 they hold example test data at the owner's request). For live or automated runs against RawTree use temporary prefixed tables (`RAWTREE_TABLE_PREFIX`) and drop them afterwards. Ask the owner before any other write to shared RawTree resources.
- Secrets live only in `.env.local` (ignored). Keep `.env.example` in sync when configuration changes.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
