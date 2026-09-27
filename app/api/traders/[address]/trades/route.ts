import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { Trade } from "@/db/models/Trade";

type Params = { params: Promise<{ address: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  await connectDb();
  const { address } = await params;

  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "25")));

  const filter = { traderAddress: address };
  const [trades, total] = await Promise.all([
    Trade.find(filter)
      .sort({ blockTime: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Trade.countDocuments(filter),
  ]);

  return NextResponse.json({
    trades,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
}
