# Contributing to RawTree Web Analytics

Contributions to the SDK, the collector, the dashboard, and the test console are welcome. The project stays small on purpose: open an issue before proposing something beyond those pieces.

## Set up

You need Node.js 24 or later and a RawTree database ([setup](README.md#-set-up-rawtree)).

```sh
git clone https://github.com/rawtreedb/rawtree-web-analytics.git
cd rawtree-web-analytics
npm ci
cp .env.example .env.local   # your database and keys; never commit this file
npm run dev                  # http://localhost:3000
```

## Before opening a pull request

```sh
npm run typecheck
npm test
npm run build
```

CI runs the same three checks on every pull request. Every pull request also gets a Vercel preview deployment.

## Guidelines

- **Keep pull requests small and focused**, with a test plan and screenshots for UI changes.
- **The event contract is `packages/analytics/src/protocol.ts`.** Keep it backward compatible: existing events must keep validating and storing the same way.
- **Dashboard SQL lives in `lib/queries.ts`.** Count each event once (`uniqExact(toString(event_id))` or `LIMIT 1 BY`), never `count()` over raw rows. Add new counting queries to `EVENT_QUERIES` so the dedup test covers them.
- **Never accept SQL or table names from the browser.** Credentials and destinations come from server configuration or the signed-in viewer's access (`lib/access.ts`).
- **Tests never write to real tables.** Use temporary tables with `RAWTREE_TABLE_PREFIX` and drop them afterwards.
- **The browser SDK stays free of rrweb** (`./recorder` is a separate entry) and the server entry free of browser globals. `packages/analytics/test/entries.test.ts` checks this.
- **Node runs the `.ts` sources directly:** erasable TypeScript only (no enums, namespaces, or parameter properties) and `.ts` extensions in relative imports.
- **Next.js 16 differs from older versions.** Check `node_modules/next/dist/docs/` before using its APIs.
- **No secrets, keys, or private event data** in code, issues, or pull requests.

[AGENTS.md](AGENTS.md) has the same rules in more detail, for people and coding agents.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
