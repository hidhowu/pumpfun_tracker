import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { deleteProxiesBulk } from "@/db/proxyService";

/** Body: { ids: string[] }. */
export async function POST(request: NextRequest) {
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "Provide 'ids' (a non-empty array)." }, { status: 400 });
  }

  const deletedCount = await deleteProxiesBulk(ids);
  return NextResponse.json({ deletedCount });
}
