import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { finishMerge, mergeStep } from "@/db/backtest/merge";

type Params = { params: Promise<{ id: string }> };

/**
 * Merges another backtest INTO this one (`id` is the target), one step per call:
 *   { sourceId, afterId?, rerun? }  - moves one page of the source's addresses (and their results) here; send back the `nextAfterId` of the answer
 *                                    until it is null. `rerun: true` puts them back to waiting so this backtest simulates them with its own settings.
 *   { sourceId, finish: true }      - the last step: makes this backtest's address count exact, pauses it if it now has addresses waiting, and removes
 *                                    the source (which by then only holds addresses this backtest already had).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  if (!sourceId) return NextResponse.json({ error: "Provide 'sourceId'." }, { status: 400 });
  try {
    if (body.finish === true) return NextResponse.json(await finishMerge(id, sourceId));
    return NextResponse.json(
      await mergeStep(id, sourceId, {
        afterId: typeof body.afterId === "string" && body.afterId ? body.afterId : null,
        rerun: body.rerun === true,
      })
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Merge failed" }, { status: 400 });
  }
}
