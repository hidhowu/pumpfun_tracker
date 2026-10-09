import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { Proxy } from "@/db/models/Proxy";
import { addProxiesBulk, toProxyView } from "@/db/proxyService";

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const proxies = await Proxy.find({}).sort({ createdAt: 1 }).lean();
  return NextResponse.json({ proxies: JSON.parse(JSON.stringify(proxies.map(toProxyView))) });
}

/** Bulk add. Body: { urls: string[] } - one proxy URL per entry (e.g. pasted, one per line, split client-side). */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const urls: string[] = Array.isArray(body.urls) ? body.urls : [];

  if (urls.length === 0) {
    return NextResponse.json({ error: "Provide 'urls' (a non-empty array)." }, { status: 400 });
  }

  const { added, skipped, invalid } = await addProxiesBulk(urls);
  return NextResponse.json({ added, skipped, invalid });
}
