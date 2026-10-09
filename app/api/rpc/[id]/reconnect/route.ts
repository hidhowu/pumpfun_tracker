import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { RpcEndpoint } from "@/db/models/RpcEndpoint";
import { SystemCommand } from "@/db/models/SystemCommand";

type Params = { params: Promise<{ id: string }> };

/** Queues a reconnect targeted at exactly this endpoint - the other endpoints keep running uninterrupted. */
export async function POST(_request: Request, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;

  const endpoint = await RpcEndpoint.findById(id);
  if (!endpoint) return NextResponse.json({ error: "RPC endpoint not found" }, { status: 404 });

  const existing = await SystemCommand.findOne({
    type: "reconnect_rpc",
    targetUrl: endpoint.url,
    status: { $in: ["pending", "processing"] },
  }).lean();
  const command = existing ?? (await SystemCommand.create({ type: "reconnect_rpc", targetUrl: endpoint.url }));
  return NextResponse.json({ command: JSON.parse(JSON.stringify(command)) });
}
