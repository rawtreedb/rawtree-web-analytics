// Server-only Vercel Connect sign-in for RawTree: the browser holds only an opaque session
// cookie, Vercel Connect stores and refreshes the RawTree grant for a hash of it.
// RawTree OAuth grants are not read-only, so the server only runs lib/queries.ts SQL and
// collector-validated inserts with them.

import { createHash, randomBytes } from "node:crypto";
import { deleteTokenCacheEntry, getToken, NoValidTokenError, UserAuthorizationRequiredError } from "@vercel/connect";
import { RawTreeError } from "./rawtree.ts";

/** Vercel Connect connector for the RawTree API, e.g. `rawtree/web-analytics`. Unset disables Connect. */
export const connector = (env: Record<string, string | undefined> = process.env) => env.RAWTREE_CONNECTOR || null;

export const newSession = () => randomBytes(32).toString("base64url");

/** Each browser session is its own Connect subject. Only a hash leaves this server. */
export function tokenParams(session: string) {
  return { subject: { type: "user" as const, id: createHash("sha256").update(session).digest("base64url") } };
}

/** The visitor's RawTree token, or a 401 RawTreeError when they must connect again. */
export async function connectToken(connectorId: string, session: string): Promise<string> {
  try {
    return await getToken(connectorId, tokenParams(session));
  } catch (error) {
    if (error instanceof UserAuthorizationRequiredError || error instanceof NoValidTokenError) {
      throw new RawTreeError("Your RawTree session expired. Connect again.", 401);
    }
    throw error;
  }
}

/** Forget a token RawTree rejected, so the next call asks Vercel Connect again. */
export function dropToken(connectorId: string, session: string): void {
  console.warn("RawTree rejected the Connect token; the visitor must connect again.");
  deleteTokenCacheEntry(connectorId, tokenParams(session));
}

export type Workspace = { organization: string; cluster: string; databases: string[] };

/** Every organization / cluster with its databases, for the picker after connecting. */
export async function listWorkspaces(connectorId: string, session: string, apiUrl: string): Promise<Workspace[]> {
  const list = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
    const token = await connectToken(connectorId, session);
    const started = Date.now();
    const response = await fetch(`${apiUrl}${path}?${new URLSearchParams(params)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const outcome = `RawTree GET ${path} -> ${response.status} in ${Date.now() - started} ms`;
    if (response.ok) console.info(outcome);
    else console.warn(outcome);
    if (response.status === 401) dropToken(connectorId, session);
    if (!response.ok) throw new RawTreeError(`Could not list RawTree ${path.slice(4)} (${response.status}).`, response.status);
    return response.json() as Promise<T>;
  };
  const { organizations } = await list<{ organizations: { name: string }[] }>("/v1/organizations");
  const perOrganization = await Promise.all(
    organizations.map(async ({ name: organization }) => {
      const { clusters } = await list<{ clusters: { name: string }[] }>("/v1/clusters", { organization });
      return Promise.all(
        clusters.map(async ({ name: cluster }) => {
          // A paused or unreachable cluster lists no databases instead of failing the picker.
          const databases = await list<{ databases: { name: string }[] }>("/v1/databases", { organization, cluster }).then(
            (body) => body.databases.map(({ name }) => name),
            (error) => {
              if (error instanceof RawTreeError && error.status === 401) throw error;
              return [];
            },
          );
          return { organization, cluster, databases };
        }),
      );
    }),
  );
  return perOrganization.flat();
}
