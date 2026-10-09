import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { exportWalletCsv, parseExportOptions } from "@/db/exportService";

type Params = { params: Promise<{ id: string }> };

/**
 * CSV download of every assigned trader's performance on this wallet.
 * ?granularity=hour|day|trade &from=YYYY-MM-DD &to=YYYY-MM-DD (both optional -
 * omitted = entire period) &tz=<minutes east of UTC> &layout=sections|flat
 * &includeEmpty=1. See db/exportService.js.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const result = await exportWalletCsv(id, parseExportOptions(request.nextUrl.searchParams));
  if (!result) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return csvResponse(result.csv, result.filename);
}

function csvResponse(csv: string, filename: string) {
  // BOM so Excel opens the file as UTF-8.
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
