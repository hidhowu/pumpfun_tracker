import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { SystemCommand } from "@/db/models/SystemCommand";

/**
 * Queues a manual "reconnect the RPC" request. The web app and the tracker
 * daemon are separate Node processes, so this is a handoff via Mongo - the
 * daemon polls SystemCommand (every 5s, see src/tracker.js's
 * startCommandPolling) and acts on it. Coalesces with any command still
 * pending so mashing the button doesn't queue up a pile of reconnects.
 */
export async function POST() {
  await connectDb();
  const existing = await SystemCommand.findOne({ type: "reconnect_rpc", status: { $in: ["pending", "processing"] } }).lean();
  const command = existing ?? (await SystemCommand.create({ type: "reconnect_rpc" }));
  return NextResponse.json({ command: JSON.parse(JSON.stringify(command)) });
}
