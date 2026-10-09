// Sign-in mode only: store the visitor's API key or Connect workspace pick in HTTP-only
// cookies, and sign out. Server actions check the request origin, so other sites can't post them.
"use server";

import { revokeToken } from "@vercel/connect";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  connectorInSignInMode,
  cookieOptions,
  DATABASE_COOKIE,
  envMode,
  KEY_COOKIE,
  parseWorkspace,
  SESSION_COOKIE,
  validDatabase,
  WORKSPACE_COOKIE,
} from "../../lib/access.ts";
import { tokenParams } from "../../lib/rawtree-connect.ts";

export async function signInWithKey(form: FormData): Promise<void> {
  if (envMode()) redirect("/");
  const key = String(form.get("key") ?? "").trim();
  const database = String(form.get("database") ?? "").trim() || "web_analytics";
  if (!key || !validDatabase(database)) redirect("/sign-in?error=key");
  const store = await cookies();
  store.delete(WORKSPACE_COOKIE);
  store.set(KEY_COOKIE, key, cookieOptions());
  store.set(DATABASE_COOKIE, database, cookieOptions());
  redirect("/");
}

export async function pickWorkspace(form: FormData): Promise<void> {
  const value = String(form.get("workspace") ?? "");
  if (!connectorInSignInMode() || !parseWorkspace(value)) redirect("/sign-in");
  const store = await cookies();
  store.delete(KEY_COOKIE);
  store.set(WORKSPACE_COOKIE, value, cookieOptions());
  redirect("/");
}

/** Revokes the Connect grant (if any) and forgets every sign-in cookie. */
export async function signOut(): Promise<void> {
  const store = await cookies();
  const connector = connectorInSignInMode();
  const session = store.get(SESSION_COOKIE)?.value;
  if (connector && session) {
    // The cookies are cleared either way; a failed revoke is logged so a lingering grant can be investigated.
    await revokeToken(connector, tokenParams(session)).catch((error) => {
      console.error(`Could not revoke the RawTree grant: ${error instanceof Error ? error.message : error}`);
    });
  }
  for (const name of [KEY_COOKIE, DATABASE_COOKIE, SESSION_COOKIE, WORKSPACE_COOKIE]) store.delete(name);
  redirect("/sign-in");
}
