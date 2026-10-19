import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { isTwoFactorEnabled } from "@/db/authService";
import { isObjectIdString } from "@/db/settingsLimits";
import { getLiveWalletDetail, renameLiveWallet } from "@/db/live/service";

type Params = { params: Promise<{ id: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  const detail = await getLiveWalletDetail(id);
  if (!detail) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  const user = (await getSessionUser())!;
  return NextResponse.json({ ...detail, twoFactorEnabled: await isTwoFactorEnabled(user.id) }, { headers: NO_STORE });
}

/** Body: { name: string } */
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const wallet = await renameLiveWallet(id, name);
  if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json({ wallet });
}
