import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { RpcEndpoint } from "@/db/models/RpcEndpoint";
import { Trader } from "@/db/models/Trader";

type Params = { params: Promise<{ id: string }> };

/** Every active trader currently assigned to this endpoint, with its live subscription status. */
export async function GET(_request: Request, { params }: Params) {
  await connectDb();
  const { id } = await params;

  const endpoint = await RpcEndpoint.findById(id).lean();
  if (!endpoint) return NextResponse.json({ error: "RPC endpoint not found" }, { status: 404 });

  const traders = await Trader.find(
    { status: "active", assignedRpcUrl: endpoint.url },
    { address: 1, label: 1, subscriptionStatus: 1 }
  )
    .sort({ address: 1 })
    .lean();

  return NextResponse.json({ addresses: JSON.parse(JSON.stringify(traders)) });
}
