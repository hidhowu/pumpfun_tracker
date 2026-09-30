import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { HttpRpcEndpoint } from "@/db/models/HttpRpcEndpoint";

type Params = { params: Promise<{ id: string }> };

/**
 * Body: { label?: string, enabled?: boolean }. No "last enabled" guard here
 * (unlike the WS RpcEndpoint route) - the tracker daemon always keeps
 * .env's SOLANA_RPC_URLS as a permanent floor in its pool (see
 * src/tracker.js's startHttpRpcPoolSync), so disabling/deleting every
 * DB-managed entry can never leave it with zero endpoints.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const update: Record<string, unknown> = {};
  if (typeof body.label === "string") update.label = body.label;
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;

  const updated = await HttpRpcEndpoint.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after" });
  if (!updated) return NextResponse.json({ error: "RPC endpoint not found" }, { status: 404 });
  return NextResponse.json({ endpoint: JSON.parse(JSON.stringify(updated)) });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const deleted = await HttpRpcEndpoint.findByIdAndDelete(id);
  if (!deleted) return NextResponse.json({ error: "RPC endpoint not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
