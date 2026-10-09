import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { exportProfileCsv, parseExportOptions } from "@/db/exportService";

type Params = { params: Promise<{ id: string }> };

/**
 * CSV download of every ACTIVE (non-blacklisted) trader's simulated
 * performance in this profile. Same query options as the wallet export -
 * see app/api/wallets/[id]/export/route.ts and db/exportService.js.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const result = await exportProfileCsv(id, parseExportOptions(request.nextUrl.searchParams));
  if (!result) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  // BOM so Excel opens the file as UTF-8.
  return new NextResponse(`\uFEFF${result.csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
