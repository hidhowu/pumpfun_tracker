import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { RpcEndpoint } from "@/db/models/RpcEndpoint";
import { Trader } from "@/db/models/Trader";

/**
 * List every RPC endpoint with how many active traders are currently
 * assigned to it, plus every active trader that ISN'T currently confirmed
 * subscribed anywhere (status "pending" - waiting on its assigned endpoint,
 * possibly disconnected/mid-reconnect, or "failed" - an actual subscribe
 * error, e.g. rate-limited) so it's visible without having to expand every
 * endpoint's address list one at a time to spot what's missing.
 */
export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const [endpoints, counts, unresolvedAddresses] = await Promise.all([
    RpcEndpoint.find({}).sort({ createdAt: 1 }).lean(),
    Trader.aggregate([
      { $match: { status: "active", assignedRpcUrl: { $ne: null } } },
      { $group: { _id: "$assignedRpcUrl", count: { $sum: 1 } } },
    ]),
    Trader.find(
      { status: "active", subscriptionStatus: { $ne: "subscribed" } },
      { address: 1, label: 1, subscriptionStatus: 1, assignedRpcUrl: 1 }
    )
      .sort({ address: 1 })
      .lean(),
  ]);

  const countByUrl = new Map(counts.map((c) => [c._id, c.count]));
  const result = endpoints.map((e) => ({ ...e, addressCount: countByUrl.get(e.url) || 0 }));

  return NextResponse.json({
    endpoints: JSON.parse(JSON.stringify(result)),
    unresolvedCount: unresolvedAddresses.length,
    unresolvedAddresses: JSON.parse(JSON.stringify(unresolvedAddresses)),
  });
}

function isValidWsUrl(url: unknown): url is string {
  return typeof url === "string" && /^wss?:\/\/.+/i.test(url.trim());
}

/** Body: { url: string, label?: string } */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!isValidWsUrl(url)) {
    return NextResponse.json({ error: "url must be a valid ws:// or wss:// endpoint" }, { status: 400 });
  }

  try {
    const endpoint = await RpcEndpoint.create({ url, label: body.label || "" });
    return NextResponse.json({ endpoint: JSON.parse(JSON.stringify(endpoint)) });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "This RPC endpoint is already registered" }, { status: 409 });
    }
    throw err;
  }
}
