import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { testRpcEndpoint } from "@/db/rpcHealth";

type Params = { params: Promise<{ id: string }> };

/**
 * Live check of exactly this endpoint (see db/rpcHealth.js) - a pass clears its rate-limit strikes and
 * un-blacklists it, a fail adds a strike (the third in a row blacklists it). Body (optional):
 * { enableOnSuccess: true } also re-enables a disabled endpoint that passes.
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const { endpoint, ...result } = await testRpcEndpoint("http", id, { enableOnSuccess: body?.enableOnSuccess === true });
    return NextResponse.json({ ...result, endpoint: JSON.parse(JSON.stringify(endpoint)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Test failed";
    return NextResponse.json({ error: message }, { status: message === "RPC endpoint not found" ? 404 : 400 });
  }
}
