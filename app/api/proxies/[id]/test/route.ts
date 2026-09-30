import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { testProxy } from "@/db/proxyService";

type Params = { params: Promise<{ id: string }> };

/** Live connectivity check through exactly this proxy - success also un-blacklists it (see db/proxyService.js's testProxy). */
export async function POST(_request: Request, { params }: Params) {
  await connectDb();
  const { id } = await params;
  try {
    const { ok, error, proxy } = await testProxy(id);
    return NextResponse.json({ ok, error: error ?? null, proxy: JSON.parse(JSON.stringify(proxy)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Test failed" }, { status: 400 });
  }
}
