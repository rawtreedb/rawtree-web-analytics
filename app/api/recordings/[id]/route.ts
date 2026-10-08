// Replay data for one recording: metadata first, then payload rows for the planned
// chunk range (bounded in bytes), reassembled into replayable segments with the same
// deduplication and gap rules as every reader.

import { DashboardQueryError, getReplay, loadQueryConfig } from "../../../../lib/dashboard.ts";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const replay = await getReplay(loadQueryConfig(), id);
    return Response.json(replay);
  } catch (error) {
    if (error instanceof DashboardQueryError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("replay query failed", error);
    return Response.json({ error: "Could not reassemble this recording." }, { status: 503 });
  }
}
