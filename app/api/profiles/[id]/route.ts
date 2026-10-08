import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { renameProfile, deleteProfile, setDefaultProfile } from "@/db/profileService";

type Params = { params: Promise<{ id: string }> };

/**
 * Body: { name?: string, isDefault?: true } - rename, and/or make this the
 * default profile (which un-defaults the previous one - see
 * db/profileService.js's setDefaultProfile).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name && body.isDefault !== true) {
    return NextResponse.json({ error: "Provide a non-empty 'name' and/or 'isDefault: true'" }, { status: 400 });
  }

  let profile = null;
  try {
    if (name) profile = await renameProfile(id, name);
    if (body.isDefault === true) profile = await setDefaultProfile(id);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update profile" }, { status: 400 });
  }
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
