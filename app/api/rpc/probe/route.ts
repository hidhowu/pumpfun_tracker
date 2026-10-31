import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/session";
import { probeRpcUrl } from "@/db/rpcHealth";

/**
 * Tests an endpoint URL that isn't saved yet (the Add dialogs' "Test" button) - nothing is written.
 * Body: { kind: "ws" | "http", url: string }
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const kind = body.kind === "ws" ? "ws" : "http";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const valid = kind === "ws" ? /^wss?:\/\/.+/i.test(url) : /^https?:\/\/.+/i.test(url);
  if (!valid) {
    return NextResponse.json({ error: `url must be a valid ${kind === "ws" ? "ws:// or wss://" : "http:// or https://"} endpoint` }, { status: 400 });
  }
  const result = await probeRpcUrl(kind, url);
  return NextResponse.json(result);
}
