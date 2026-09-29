import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { RpcEndpoint } from "@/db/models/RpcEndpoint";

type Params = { params: Promise<{ id: string }> };

/** Body: { label?: string, enabled?: boolean }. Disabling the last enabled endpoint is rejected - it would leave zero tracking coverage. */
export async function PATCH(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const endpoint = await RpcEndpoint.findById(id);
  if (!endpoint) return NextResponse.json({ error: "RPC endpoint not found" }, { status: 404 });

  if (body.enabled === false && endpoint.enabled) {
    const enabledCount = await RpcEndpoint.countDocuments({ enabled: true });
    if (enabledCount <= 1) {
      return NextResponse.json(
        { error: "Can't disable the last active RPC endpoint - every tracked address would stop updating." },
        { status: 400 }
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (typeof body.label === "string") update.label = body.label;
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;

  const updated = await RpcEndpoint.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after" });
  return NextResponse.json({ endpoint: JSON.parse(JSON.stringify(updated)) });
}

/** Deleting redistributes its addresses to the remaining active endpoints on the daemon's next sync pass. Rejected if it's the last enabled one. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;

  const endpoint = await RpcEndpoint.findById(id);
  if (!endpoint) return NextResponse.json({ error: "RPC endpoint not found" }, { status: 404 });

  if (endpoint.enabled) {
    const enabledCount = await RpcEndpoint.countDocuments({ enabled: true });
    if (enabledCount <= 1) {
      return NextResponse.json(
        { error: "Can't delete the last active RPC endpoint - every tracked address would stop updating." },
        { status: 400 }
      );
    }
  }

  await RpcEndpoint.deleteOne({ _id: id });
  return NextResponse.json({ deleted: true });
}
