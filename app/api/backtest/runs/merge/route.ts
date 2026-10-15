import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { previewMerge } from "@/db/backtest/merge";

/**
 * Body: { targetId: string, sourceIds: string[] } - what merging the sources into the target would do: for each source its size, whether it can be
 * merged right now, and how its simulation settings differ from the target's (and so whether its addresses would be simulated again).
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  try {
    const preview = await previewMerge(
      String(body.targetId || ""),
      Array.isArray(body.sourceIds) ? body.sourceIds.filter((id: unknown) => typeof id === "string") : []
    );
    return NextResponse.json(preview);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to prepare the merge" }, { status: 400 });
  }
}
