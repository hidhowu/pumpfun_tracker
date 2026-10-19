import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { Profile } from "@/db/models/Profile";
import { createProfile } from "@/db/profileService";
import { isObjectIdString } from "@/db/settingsLimits";

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const profiles = await Profile.find({}).sort({ createdAt: 1 }).lean();
  return NextResponse.json({ profiles: JSON.parse(JSON.stringify(profiles)) });
}

/**
 * Body: { name: string, mode: "fresh"|"clone", sourceProfileId?: string }.
 * "fresh" copies the source profile's settings only (or defaults, if no
 * source) with a clean simulated wallet; "clone" forks the source's entire
 * current state (positions, balance, history) - see db/profileService.js.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (body.mode !== "fresh" && body.mode !== "clone") {
    return NextResponse.json({ error: "mode must be 'fresh' or 'clone'" }, { status: 400 });
  }
  if (body.mode === "clone" && !body.sourceProfileId) {
    return NextResponse.json({ error: "sourceProfileId is required when mode is 'clone'" }, { status: 400 });
  }
  // Must be a plain id string: an object here ({"$ne": null}) would otherwise reach the Mongo filter as an operator.
  if (body.sourceProfileId != null && !isObjectIdString(body.sourceProfileId)) {
    return NextResponse.json({ error: "sourceProfileId must be a valid profile id" }, { status: 400 });
  }

  try {
    const profile = await createProfile({ name: name.slice(0, 100), mode: body.mode, sourceProfileId: body.sourceProfileId ?? undefined });
    return NextResponse.json({ profile: JSON.parse(JSON.stringify(profile)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create profile" }, { status: 400 });
  }
}
