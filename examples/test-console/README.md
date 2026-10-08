# RawTree Web Analytics test console

A one-page console (Vite, React, Tailwind, styled like the RawTree dashboard) to send browser events, server events, and session recordings through the **packed** `@rawtree/analytics` tarball and watch each one go Queued → Sent (collector 200) → Stored (found in RawTree). It is a separate npm project, not a workspace, so it uses the package exactly as a third party would. The [tracking recipes](recipes/RECIPES.md) live in `recipes/` and are typechecked against the same package.

## Install

```sh
# From the repository root: build and pack the SDK into vendor/ and install it here
npm run console:install
```

After changing the SDK, run `npm run console:install` again. A plain `npm install` here fails with `EINTEGRITY` because `package-lock.json` pins the old tarball hash.

## Run

```sh
npm run dev          # in the repository root, collector on port 3100: PORT=3100 npm run dev
npm start            # here: vite build + node server.ts -> http://localhost:5173
```

The collector must list `http://localhost:5173` in `ANALYTICS_ALLOWED_ORIGINS`. Server events need the same `ANALYTICS_SERVER_TOKEN` on both sides. The Stored column needs `RAWTREE_DATABASE` and the read-only `RAWTREE_QUERY_KEY`.

## Environment (console server)

| Variable | Default |
| --- | --- |
| `PORT` | `5173` |
| `COLLECTOR_URL` | `http://localhost:3100/api/collect` |
| `ANALYTICS_SERVER_TOKEN` | unset: server events disabled |
| `RAWTREE_API_URL` | `https://api.rawtree.com` |
| `RAWTREE_DATABASE`, `RAWTREE_QUERY_KEY` | unset: "storage check not configured" |
| `RAWTREE_TABLE_PREFIX` | empty |
| `CONSOLE_ENV_FILE` | `../../.env.local`, loaded when it exists without overriding set variables. `none` disables it |

Secrets stay on the server: `/api/config` returns only the collector URL, database name, and two booleans.

## Checks

```sh
npx tsc --noEmit     # app, server, scripts, and recipes against the packed types
npm run build
npm run size         # eager vs lazy JS sizes; fails if rrweb is in the eager bundle
npm run smoke        # mock collector + console server + headless system Chrome
```

The smoke test uses `playwright-core` from the repository root and never contacts RawTree. `SMOKE_SCREENSHOT=path.png` saves a screenshot. `SMOKE_FORWARD_TO=http://localhost:3100/api/collect` also forwards every valid request to a real collector (run with `SMOKE_APP_PORT=5173` and `SMOKE_SERVER_TOKEN=<collector token>`). Forwarded data is written to whatever tables that collector uses.
