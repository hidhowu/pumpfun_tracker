import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { addTradersToList, removeTradersFromList } from "@/db/listService";

type Params = { params: Promise<{ id: string }> };

/** Body: { addresses: string[] } - tags every given address into this list. */
export async function POST(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const addresses: string[] = Array.isArray(body.addresses) ? body.addresses : [];
  if (addresses.length === 0) return NextResponse.json({ error: "Provide 'addresses' (a non-empty array)." }, { status: 400 });

  const modifiedCount = await addTradersToList(id, addresses);
  return NextResponse.json({ modifiedCount });
}

/** Body: { addresses: string[] } - untags every given address from this list. */
export async function DELETE(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const addresses: string[] = Array.isArray(body.addresses) ? body.addresses : [];
  if (addresses.length === 0) return NextResponse.json({ error: "Provide 'addresses' (a non-empty array)." }, { status: 400 });

  const modifiedCount = await removeTradersFromList(id, addresses);
  return NextResponse.json({ modifiedCount });
}
