# rawtree-web-analytics

Read `IMPLEMENTATION.md` first: it holds the plan, milestone status, and session ledger. Update the ledger when you finish a session.

## Scope

Keep it simple. The project is only: an SDK to send events, examples, and a dashboard. The in-app agent is deferred (see `IMPLEMENTATION.md`). Anything beyond that needs the owner's agreement first. Write tests that catch real regressions in those pieces, not tests for their own sake.

## Layout

- `packages/analytics/`: the publishable SDK (`@rawtree/analytics`). `src/protocol.ts` is the event contract; its types and validator are the source of truth for the SDK and the collector.
- `app/api/collect/route.ts` + `lib/collect.ts`, `lib/rawtree.ts`: the Next.js collector.
- `lib/queries.ts`: every dashboard SQL query (one documented template per widget; aliases are the fields `app/page.tsx` reads). `lib/dashboard.ts` runs them; pages import only `lib/dashboard.ts`. Bot detection lives in `lib/crawlers.ts`, date ranges in `lib/range.ts`.
- `examples/test-console/`: separate npm project (Vite + React test console styled like the RawTree dashboard) that installs the **packed** SDK tarball, plus the tracking recipes (`recipes/RECIPES.md`).
- `test/`: collector tests.

## Commands

```sh
npm install
npm test             # builds the SDK, runs SDK and collector tests
npm run typecheck
npm run build        # SDK + Next.js
npm run console:install                      # pack the SDK and install it into the test console
cd examples/test-console && npx tsc --noEmit && npm run build && npm run size && npm run smoke
```

Node ≥ 24 runs `.ts` directly: use erasable syntax only (no enums, namespaces, or parameter properties) and `.ts` extensions in relative imports.

## Invariants

- The browser SDK must stay free of rrweb (`./recorder` is a separate entry) and the server entry free of browser globals. Check with `npm run size` in the test console.
- The collector acknowledges only after RawTree accepted every row. Credentials and table destinations come from configuration, never from requests.
- Delivery is at least once: keep IDs stable across retries and deduplicate in every query (`uniqExact(event_id)` or `LIMIT 1 BY`).
- RawTree reads lag writes by about 0.1–0.4 s and replicas can disagree briefly. Poll in tests; never assume read-after-write.
- Write synthetic data to the real `events`/`recordings` tables only when the owner asks (since 2026-10-08 they hold example test data at the owner's request). For automated tests use temporary prefixed tables (`RAWTREE_TABLE_PREFIX`) and drop them afterwards. Ask the owner before any other write to shared RawTree resources.
- Secrets live only in `.env.local` (ignored). Keep `.env.example` in sync when configuration changes.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
