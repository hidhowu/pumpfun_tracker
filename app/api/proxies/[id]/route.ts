import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { Proxy } from "@/db/models/Proxy";
import { invalidateProxyPoolCache } from "@/db/proxyService";

type Params = { params: Promise<{ id: string }> };

/** Body: { label?: string, enabled?: boolean }. Toggling enabled takes effect on the pool's next read (cache invalidated here). */
export async function PATCH(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const update: Record<string, unknown> = {};
  if (typeof body.label === "string") update.label = body.label;
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;

  const updated = await Proxy.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after" });
  if (!updated) return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
  invalidateProxyPoolCache();
  return NextResponse.json({ proxy: JSON.parse(JSON.stringify(updated)) });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const deleted = await Proxy.findByIdAndDelete(id);
  if (!deleted) return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
  invalidateProxyPoolCache();
  return NextResponse.json({ deleted: true });
}
