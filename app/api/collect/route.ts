import { handleCollect, handleCollectOptions } from "../../../lib/collect.ts";

export async function POST(request: Request): Promise<Response> {
  return handleCollect(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handleCollectOptions(request);
}
