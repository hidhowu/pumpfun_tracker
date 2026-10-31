import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { RpcEndpoint } from "@/db/models/RpcEndpoint";

/**
 * Body: { ids: string[] }. Rejected if it would remove every endpoint that's still usable (enabled and
 * not blacklisted) - every tracked address would stop updating. Blacklisted ones are always safe to remove.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });

  const remainingUsable = await RpcEndpoint.countDocuments({ _id: { $nin: ids }, enabled: true, health: { $ne: "blacklisted" } });
  if (remainingUsable === 0) {
    return NextResponse.json(
      { error: "Can't delete every usable RPC endpoint - every tracked address would stop updating." },
      { status: 400 }
    );
  }
  const result = await RpcEndpoint.deleteMany({ _id: { $in: ids } });
  return NextResponse.json({ deletedCount: result.deletedCount || 0 });
}
