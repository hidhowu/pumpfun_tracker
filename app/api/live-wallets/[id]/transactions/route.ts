import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { getLiveWalletTransactions } from "@/db/live/service";

type Params = { params: Promise<{ id: string }> };
const KINDS = new Set(["buy", "sell", "receive", "send", "burn", "sol_in", "sol_out", "other", "failed"]);
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Query: mint? (a token mint, or "SOL" for the wallet's SOL movements), kind?, page?, limit? (max 100). Brings the stored history up to date first. */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

  const q = request.nextUrl.searchParams;
  const mint = q.get("mint");
  const kind = q.get("kind");
  if (mint && mint !== "SOL" && !MINT_RE.test(mint)) return NextResponse.json({ error: "Invalid mint" }, { status: 400 });
  if (kind && !KINDS.has(kind)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  const page = Math.max(1, Math.floor(Number(q.get("page"))) || 1);
  const limit = Math.min(100, Math.max(1, Math.floor(Number(q.get("limit"))) || 25));

  const result = await getLiveWalletTransactions(id, { mint, kind, page, limit });
  if (!result) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
