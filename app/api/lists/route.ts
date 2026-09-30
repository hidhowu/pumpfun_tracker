import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { createList, listAllWithCounts } from "@/db/listService";

export async function GET() {
  await connectDb();
  const lists = await listAllWithCounts();
  return NextResponse.json({ lists: JSON.parse(JSON.stringify(lists)) });
}

/** Body: { name: string } */
export async function POST(request: NextRequest) {
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const list = await createList(name);
    return NextResponse.json({ list: JSON.parse(JSON.stringify(list)) });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "A list with this name already exists" }, { status: 409 });
    }
    throw err;
  }
}
