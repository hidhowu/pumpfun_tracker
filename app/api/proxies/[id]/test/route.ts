import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { testProxy, toProxyView } from "@/db/proxyService";

type Params = { params: Promise<{ id: string }> };

/**
 * Live connectivity check through exactly this proxy - success also
 * un-blacklists it (see db/proxyService.js's testProxy). Body (optional):
 * { enableOnSuccess: true } also re-enables a disabled proxy that passes.
 */
export async function POST(request: Request, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const { ok, error, proxy } = await testProxy(id, { enableOnSuccess: body?.enableOnSuccess === true });
    return NextResponse.json({ ok, error: error ?? null, proxy: proxy && JSON.parse(JSON.stringify(toProxyView(proxy.toObject()))) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Test failed" }, { status: 400 });
  }
}
