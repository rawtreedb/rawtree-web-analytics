// Collector for the dashboard's test console: the same validation and acknowledged insert
// as /api/collect, but with the signed-in visitor's credentials, so test traffic only lands
// in their own database. Same-origin browser requests only; no server token is accepted.

import { getAccess } from "../../../../lib/access.ts";
import { handleCollect } from "../../../../lib/collect.ts";

export async function POST(request: Request): Promise<Response> {
  const access = await getAccess();
  if (!access) return Response.json({ error: "unauthorized", message: "Sign in first." }, { status: 401 });
  return handleCollect(request, { rawtree: access.ingest, allowedOrigins: [new URL(request.url).origin] });
}
