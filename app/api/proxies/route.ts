import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { Proxy } from "@/db/models/Proxy";
import { addProxiesBulk } from "@/db/proxyService";

export async function GET() {
  await connectDb();
  const proxies = await Proxy.find({}).sort({ createdAt: 1 }).lean();
  return NextResponse.json({ proxies: JSON.parse(JSON.stringify(proxies)) });
}

/** Bulk add. Body: { urls: string[] } - one proxy URL per entry (e.g. pasted, one per line, split client-side). */
export async function POST(request: NextRequest) {
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const urls: string[] = Array.isArray(body.urls) ? body.urls : [];

  if (urls.length === 0) {
    return NextResponse.json({ error: "Provide 'urls' (a non-empty array)." }, { status: 400 });
  }

  const { added, skipped, invalid } = await addProxiesBulk(urls);
  return NextResponse.json({ added, skipped, invalid });
}
