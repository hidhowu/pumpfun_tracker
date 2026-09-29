import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { renameProfile, deleteProfile } from "@/db/profileService";

type Params = { params: Promise<{ id: string }> };

/** Body: { name: string } */
export async function PATCH(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const profile = await renameProfile(id, name);
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  return NextResponse.json({ profile: JSON.parse(JSON.stringify(profile)) });
}

/** Deletes a profile and every document scoped to it. Rejected for the Default profile or the last remaining one. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;

  try {
    await deleteProfile(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete profile" }, { status: 400 });
  }
}
