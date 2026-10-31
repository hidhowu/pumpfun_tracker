import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { HttpRpcEndpoint } from "@/db/models/HttpRpcEndpoint";

/** Body: { ids: string[] }. Safe to delete everything - .env's SOLANA_RPC_URLS stays as the pool's floor. */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  const result = await HttpRpcEndpoint.deleteMany({ _id: { $in: ids } });
  return NextResponse.json({ deletedCount: result.deletedCount || 0 });
}
