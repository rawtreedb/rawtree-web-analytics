// Replay data for one recording: metadata first, then payload rows for the planned
// chunk range (bounded in bytes), reassembled into replayable segments with the same
// deduplication and gap rules as every reader.

import { getReplay, queryErrorMessage } from "../../../../lib/dashboard.ts";
import { RawTreeError } from "../../../../lib/rawtree.ts";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  try {
    return Response.json(await getReplay(id));
  } catch (error) {
    const status = error instanceof RawTreeError ? error.status : 503;
    return Response.json({ error: queryErrorMessage(error, "Could not reassemble this recording.") }, { status });
  }
}
