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
npm run typecheck   # also typechecks the recipes in examples/recipes/
npm test            # offline: RawTree is mocked
npm run build
```

CI runs the same three checks on every pull request. Every pull request also gets a Vercel preview deployment.

## Guidelines

- **Keep pull requests small and focused**, with a test plan and screenshots for UI changes.
- **The event contract is `packages/analytics/src/protocol.ts`.** Keep it backward compatible: existing events must keep validating and storing the same way.
- **Dashboard SQL lives in `lib/queries.ts`** and follows the [query rules](README.md#-ask-your-ai-agent): count each event once (`uniqExact(toString(event_id))` or `LIMIT 1 BY`), never `count()` over raw rows. Add new counting queries to `EVENT_QUERIES` so the dedup test covers them. The README's [add a widget](README.md#-customize-it) steps cover the rest.
- **The collector acknowledges only after RawTree accepted every row.** Keep event and chunk IDs stable across retries.
- **Never accept SQL or table names from the browser.** Credentials and destinations come from server configuration or the signed-in visitor's access (`lib/access.ts`).
- **Tests stay offline.** Mock `fetch` instead of calling RawTree. For a manual run against real RawTree, set `RAWTREE_TABLE_PREFIX` (e.g. `e2e_`) to use disposable tables, and drop them afterwards.
- **RawTree reads lag writes** by a fraction of a second, and replicas can briefly disagree. Poll, and never assume read-after-write.
- **The browser SDK stays free of rrweb** (`./recorder` is a separate entry): `packages/analytics/test/entries.test.ts` checks it. **The server entry stays free of browser globals:** `server.test.ts` checks it.
- **Node runs the `.ts` sources directly:** erasable TypeScript only (no enums, namespaces, or parameter properties) and `.ts` extensions in relative imports.
- **Next.js 16 differs from older versions.** Check `node_modules/next/dist/docs/` before using its APIs.
- **Configuration changes** go in `.env.example` too. Secrets live only in `.env.local`.
- **No secrets, keys, or private event data** in code, issues, or pull requests.

## Releasing the SDK (maintainers)

`@rawtree/analytics` is published to npm by the [Release SDK](.github/workflows/release-sdk.yml) workflow, with provenance.

1. Bump `version` in `packages/analytics/package.json` in a pull request (semver: breaking changes to the event contract or the public API need a major version once we're past 0.x) and merge it.
2. Tag the merge commit and push the tag: `git tag analytics-v0.2.0 && git push origin analytics-v0.2.0`.
3. The workflow checks that the tag matches the version, runs the tests, and publishes.

One-time setup: an npm account with publish rights on the `@rawtree` scope, and on npmjs.com a trusted publisher for this repository and the `release-sdk.yml` workflow (or an `NPM_TOKEN` repository secret). Provenance requires the repository to be public.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
