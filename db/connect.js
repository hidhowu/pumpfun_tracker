import mongoose from "mongoose";

let cached = global.__mongooseConnection;
if (!cached) {
  cached = global.__mongooseConnection = { conn: null, promise: null };
}

/**
 * Shared Mongoose connection, safe to call repeatedly (Next.js API routes,
 * the tracker daemon, and one-off scripts all just call this). Whoever
 * calls it first must have already made sure MONGODB_URI is in
 * process.env - Next.js does this itself; the tracker daemon does it via
 * src/env.js.
 */
export async function connectDb() {
  if (cached.conn) return cached.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (check your .env file)");
  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, { bufferCommands: false }).then((m) => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
