// Who may read and write which RawTree database for the current request.
// - Env mode: RAWTREE_QUERY_KEY and RAWTREE_INGEST_KEY are set. No sign-in, no Connect.
// - Sign-in mode: otherwise. The visitor brings an API key (cookie) or a Vercel Connect
//   grant (opaque session cookie plus the picked organization / cluster / database).
// The API URL and table prefix always come from the environment; the browser picks at most
// a database it can access, never SQL or table names.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RawTreeError, rawTreeApiUrl, type RawTreeConfig } from "./rawtree.ts";
import { connectToken, connector, dropToken } from "./rawtree-connect.ts";

export type Access = {
  mode: "env" | "key" | "connect";
  /** Reads: dashboard, recordings, console storage checks. */
  query: RawTreeConfig;
  /** Inserts: the console collect route (and /api/collect only in env mode). */
  ingest: RawTreeConfig;
  /** Shown in the UI, e.g. "web_analytics" or "rawtree / internal_projects / web_analytics". */
  label: string;
};

type Env = Record<string, string | undefined>;

export const envMode = (env: Env = process.env) => Boolean(env.RAWTREE_QUERY_KEY && env.RAWTREE_INGEST_KEY);

/** Connect is offered only in sign-in mode and when a connector is configured. */
export const connectorInSignInMode = (env: Env = process.env) => (envMode(env) ? null : connector(env));

export const KEY_COOKIE = "rawtree_key";
export const DATABASE_COOKIE = "rawtree_database";
export const SESSION_COOKIE = "rawtree_session";
export const WORKSPACE_COOKIE = "rawtree_workspace";

/** HTTP-only, same-site cookie that ends with the browser session (no maxAge). */
export const cookieOptions = (env: Env = process.env) => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

export const validDatabase = (name: string) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name);

export type WorkspacePick = { organization: string; cluster: string; database: string };

export function parseWorkspace(value: string | undefined): WorkspacePick | null {
  try {
    const { organization, cluster, database } = JSON.parse(value ?? "") as Partial<WorkspacePick>;
    const name = (part: unknown) => typeof part === "string" && part.length > 0 && part.length <= 200;
    return name(organization) && name(cluster) && typeof database === "string" && validDatabase(database)
      ? { organization: organization!, cluster: cluster!, database }
      : null;
  } catch {
    return null;
  }
}

/** Access from the environment, or from the visitor's cookies in sign-in mode. */
export function accessFromCookies(read: (name: string) => string | undefined, env: Env = process.env): Access | null {
  const base = { apiUrl: rawTreeApiUrl(env), tablePrefix: env.RAWTREE_TABLE_PREFIX ?? "" };
  if (envMode(env)) {
    // No throw here (this runs in the root layout): a missing RAWTREE_DATABASE fails the first query instead.
    const database = env.RAWTREE_DATABASE ?? "";
    const query = { ...base, database, key: env.RAWTREE_QUERY_KEY ?? "" };
    return { mode: "env", query, ingest: { ...base, database, key: env.RAWTREE_INGEST_KEY ?? "" }, label: database || "No database set" };
  }

  const key = read(KEY_COOKIE);
  const database = read(DATABASE_COOKIE) ?? "";
  if (key && validDatabase(database)) {
    // One read-and-write key serves the dashboard and the console.
    const config = { ...base, database, key };
    return { mode: "key", query: config, ingest: config, label: database };
  }

  const connectorId = connector(env);
  const session = read(SESSION_COOKIE);
  const pick = parseWorkspace(read(WORKSPACE_COOKIE));
  if (connectorId && session && pick) {
    const config: RawTreeConfig = {
      ...base,
      database: pick.database,
      key: "",
      connect: {
        organization: pick.organization,
        cluster: pick.cluster,
        token: () => connectToken(connectorId, session),
        onUnauthorized: () => dropToken(connectorId, session),
      },
    };
    return { mode: "connect", query: config, ingest: config, label: `${pick.organization} / ${pick.cluster} / ${pick.database}` };
  }
  return null;
}

/** For server components and route handlers. null = signed out (sign-in mode only). */
export async function getAccess(): Promise<Access | null> {
  if (envMode()) return accessFromCookies(() => undefined);
  const store = await cookies();
  return accessFromCookies((name) => store.get(name)?.value);
}

/** For pages: returns Access or redirects to /sign-in. */
export async function requireAccess(): Promise<Access> {
  return (await getAccess()) ?? redirect("/sign-in");
}

/**
 * For pages, in the catch of a RawTree call: in sign-in mode a rejected key or grant sends
 * the visitor to sign in again. In env mode the page shows the error (a misconfigured key).
 */
export function signInAgainIfRejected(error: unknown): void {
  if (error instanceof RawTreeError && error.status === 401 && !envMode()) redirect("/sign-in?expired=1");
}
