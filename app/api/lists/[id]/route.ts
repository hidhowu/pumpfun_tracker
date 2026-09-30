import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { deleteList, renameList } from "@/db/listService";

type Params = { params: Promise<{ id: string }> };

/** Body: { name: string } */
export async function PATCH(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const updated = await renameList(id, name);
  if (!updated) return NextResponse.json({ error: "List not found" }, { status: 404 });
  return NextResponse.json({ list: JSON.parse(JSON.stringify(updated)) });
}

/** Deletes the list and untags every trader that had it - never leaves a dangling listId. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  await deleteList(id);
  return NextResponse.json({ deleted: true });
}
