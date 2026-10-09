// Starts the RawTree consent flow through Vercel Connect (sign-in mode only) and returns
// the visitor to /sign-in to pick an organization, cluster, and database.

import { startAuthorization } from "@vercel/connect";
import { NextResponse, type NextRequest } from "next/server";
import { connectorInSignInMode, cookieOptions, SESSION_COOKIE } from "../../../../lib/access.ts";
import { newSession, tokenParams } from "../../../../lib/rawtree-connect.ts";

export async function GET(request: NextRequest): Promise<Response> {
  const connector = connectorInSignInMode();
  if (!connector) return new Response("Vercel Connect is not configured.", { status: 404 });

  const session = request.cookies.get(SESSION_COOKIE)?.value || newSession();
  const { url } = await startAuthorization(connector, tokenParams(session), {
    callbackUrl: new URL("/sign-in", request.nextUrl).toString(),
  });
  const response = NextResponse.redirect(url);
  // Like the grant it names, the opaque session outlives the browser session (30 days).
  response.cookies.set(SESSION_COOKIE, session, { ...cookieOptions(), maxAge: 60 * 60 * 24 * 30 });
  return response;
}
