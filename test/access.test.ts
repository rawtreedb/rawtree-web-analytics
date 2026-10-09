// Sign-in gating: env mode stays as it was, signed-out requests are rejected, the browser can
// pick only a database (never the API URL, SQL, or table names), and Connect calls use the
// visitor's token without leaking it.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, mock, test } from "node:test";

// `next` has no exports map: resolve "next/headers" like the bundler does ("next/headers.js").
registerHooks({ resolve: (specifier, context, next) => next(/^next\/[a-z]+$/.test(specifier) ? `${specifier}.js` : specifier, context) });

class UserAuthorizationRequiredError extends Error {}
class NoValidTokenError extends Error {}
const connect = {
  getToken: mock.fn(async (_connector: string, _params: unknown) => "connect-token"),
  deleteTokenCacheEntry: mock.fn((_connector: string, _params: unknown) => {}),
};
mock.module("@vercel/connect", {
  namedExports: {
    getToken: (connector: string, params: unknown) => connect.getToken(connector, params),
    deleteTokenCacheEntry: (connector: string, params: unknown) => connect.deleteTokenCacheEntry(connector, params),
    startAuthorization: async () => ({ url: "https://vercel.test/authorize" }),
    revokeToken: async () => {},
    UserAuthorizationRequiredError,
    NoValidTokenError,
  },
});
// Route handlers read cookies through next/headers; a signed-out browser sends none.
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => undefined }) } });

const { accessFromCookies, connectorInSignInMode, cookieOptions } = await import("../lib/access.ts");
const { tokenParams } = await import("../lib/rawtree-connect.ts");
const { RawTreeError, runQuery, tableName } = await import("../lib/rawtree.ts");

const envKeys = {
  RAWTREE_DATABASE: "web_analytics",
  RAWTREE_QUERY_KEY: "rt_query",
  RAWTREE_INGEST_KEY: "rt_ingest",
  RAWTREE_CONNECTOR: "rawtree/test",
};
const signInEnv = { RAWTREE_API_URL: "https://api.rawtree.test", RAWTREE_TABLE_PREFIX: "e2e_", RAWTREE_CONNECTOR: "rawtree/test" };
const cookieJar = (values: Record<string, string>) => (name: string) => values[name];
const pick = JSON.stringify({ organization: "acme", cluster: "main", database: "web_analytics" });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  connect.getToken.mock.resetCalls();
  connect.deleteTokenCacheEntry.mock.resetCalls();
});

function stubFetch(handler: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler();
  }) as typeof fetch;
  return calls;
}

test("env mode uses the env keys, ignores sign-in cookies, and never offers Connect", () => {
  const access = accessFromCookies(cookieJar({ rawtree_key: "rt_visitor", rawtree_database: "other", rawtree_session: "s", rawtree_workspace: pick }), envKeys);
  assert.equal(access?.mode, "env");
  assert.equal(access?.query.key, "rt_query");
  assert.equal(access?.ingest.key, "rt_ingest");
  assert.equal(access?.query.connect, undefined);
  assert.equal(connectorInSignInMode(envKeys), null);
  assert.equal(connectorInSignInMode(signInEnv), "rawtree/test");
});

test("without valid sign-in cookies the visitor is signed out", () => {
  assert.equal(accessFromCookies(cookieJar({}), signInEnv), null);
  assert.equal(accessFromCookies(cookieJar({ rawtree_key: "rt_visitor" }), signInEnv), null, "a key needs a database");
  assert.equal(accessFromCookies(cookieJar({ rawtree_workspace: pick }), signInEnv), null, "a pick needs a Connect session");
  assert.equal(accessFromCookies(cookieJar({ rawtree_session: "s" }), signInEnv), null, "a session needs a pick");
  const noConnector = { ...signInEnv, RAWTREE_CONNECTOR: "" };
  assert.equal(accessFromCookies(cookieJar({ rawtree_session: "s", rawtree_workspace: pick }), noConnector), null);
});

test("the browser chooses only a database name; API URL and tables come from the environment", () => {
  for (const database of ["web_analytics.events", "x; DROP TABLE events", "../other", "1abc", ""]) {
    assert.equal(accessFromCookies(cookieJar({ rawtree_key: "rt_visitor", rawtree_database: database }), signInEnv), null, database);
  }
  const access = accessFromCookies(cookieJar({ rawtree_key: "rt_visitor", rawtree_database: "my_site" }), signInEnv);
  assert.equal(access?.mode, "key");
  assert.equal(access?.query, access?.ingest, "one read-and-write key serves reads and inserts");
  assert.equal(access?.query.apiUrl, "https://api.rawtree.test");
  assert.equal(tableName(access!.query, "events"), "e2e_events");
  const badPick = JSON.stringify({ organization: "acme", cluster: "main", database: "db.events" });
  assert.equal(accessFromCookies(cookieJar({ rawtree_session: "s", rawtree_workspace: badPick }), signInEnv), null);
});

test("sign-in cookies are HTTP-only, same-site, and end with the browser session", () => {
  const options: Record<string, unknown> = cookieOptions({ NODE_ENV: "production" });
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.secure, true);
  assert.equal(options.path, "/");
  assert.ok(!("maxAge" in options) && !("expires" in options));
  assert.equal(cookieOptions({ NODE_ENV: "development" }).secure, false);
});

test("signed-out replay requests are rejected before any RawTree call", async () => {
  const saved = { ...process.env };
  for (const name of ["RAWTREE_QUERY_KEY", "RAWTREE_INGEST_KEY"]) delete process.env[name];
  const calls = stubFetch(() => Response.json({}));
  try {
    const { GET } = await import("../app/api/recordings/[id]/route.ts");
    const response = await GET(new Request("http://localhost/api/recordings/r1"), { params: Promise.resolve({ id: "r1" }) });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  } finally {
    process.env = saved;
  }
});

test("Connect queries use the visitor's token and picked workspace, and log without the token", async () => {
  const access = accessFromCookies(cookieJar({ rawtree_session: "browser-session", rawtree_workspace: pick }), signInEnv)!;
  assert.equal(access.mode, "connect");
  assert.equal(access.label, "acme / main / web_analytics");
  const info = mock.method(console, "info", () => {});
  const calls = stubFetch(() => Response.json({ meta: [], data: [] }));
  await runQuery(access.query, "SELECT 1");
  const logged = info.mock.calls.map((call) => String(call.arguments[0])).join("\n");
  info.mock.restore();

  const url = new URL(calls[0]!.url);
  assert.equal(url.origin + url.pathname, "https://api.rawtree.test/v1/query");
  assert.deepEqual([url.searchParams.get("organization"), url.searchParams.get("cluster"), url.searchParams.get("database")], ["acme", "main", "web_analytics"]);
  assert.equal(new Headers(calls[0]!.init?.headers).get("Authorization"), "Bearer connect-token");
  assert.deepEqual(connect.getToken.mock.calls[0]!.arguments, ["rawtree/test", tokenParams("browser-session")]);
  assert.notEqual(tokenParams("browser-session").subject.id, "browser-session", "only a hash of the session leaves the server");
  assert.match(logged, /^RawTree POST \/v1\/query \(acme\/main\/web_analytics\) -> 200 in \d+ ms$/);
  assert.doesNotMatch(logged, /connect-token|SELECT/);
});

test("a rejected or missing Connect grant becomes a 401 and drops the cached token", async () => {
  const access = accessFromCookies(cookieJar({ rawtree_session: "s", rawtree_workspace: pick }), signInEnv)!;
  const warn = mock.method(console, "warn", () => {});
  stubFetch(() => new Response("revoked", { status: 401 }));
  await assert.rejects(runQuery(access.query, "SELECT 1"), (error) => error instanceof RawTreeError && error.status === 401);
  assert.deepEqual(connect.deleteTokenCacheEntry.mock.calls[0]!.arguments, ["rawtree/test", tokenParams("s")]);
  warn.mock.restore();

  const calls = stubFetch(() => Response.json({}));
  connect.getToken.mock.mockImplementationOnce(async () => {
    throw new UserAuthorizationRequiredError();
  });
  await assert.rejects(runQuery(access.query, "SELECT 1"), (error) => error instanceof RawTreeError && error.status === 401);
  assert.equal(calls.length, 0);
});
