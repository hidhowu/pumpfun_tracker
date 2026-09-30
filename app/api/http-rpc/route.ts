import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { HttpRpcEndpoint } from "@/db/models/HttpRpcEndpoint";

export async function GET() {
  await connectDb();
  const endpoints = await HttpRpcEndpoint.find({}).sort({ createdAt: 1 }).lean();
  return NextResponse.json({ endpoints: JSON.parse(JSON.stringify(endpoints)) });
}

function isValidHttpUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\/.+/i.test(url.trim());
}

/** Body: { url: string, label?: string } */
export async function POST(request: NextRequest) {
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!isValidHttpUrl(url)) {
    return NextResponse.json({ error: "url must be a valid http:// or https:// endpoint" }, { status: 400 });
  }

  try {
    const endpoint = await HttpRpcEndpoint.create({ url, label: body.label || "" });
    return NextResponse.json({ endpoint: JSON.parse(JSON.stringify(endpoint)) });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "This RPC endpoint is already registered" }, { status: 409 });
    }
    throw err;
  }
}
