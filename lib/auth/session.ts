import { cache } from "react";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { createSession, deleteSession, findSessionUser, SESSION_MAX_AGE_MS } from "@/db/authService";
import { clientIp, hashSessionToken, isHttpsRequest, issueSessionToken, sessionCookieName, verifySessionCookie } from "./token";

export type SessionUser = { id: string; username: string };

async function cookieContext() {
  const https = isHttpsRequest(await headers());
  return {
    store: await cookies(),
    name: sessionCookieName(https),
    options: { httpOnly: true, secure: https, sameSite: "lax" as const, path: "/", priority: "high" as const },
  };
}

async function currentToken(): Promise<string | null> {
  const { store, name } = await cookieContext();
  return verifySessionCookie(store.get(name)?.value);
}

/** The signed-in user for this request, or null - checked against the database, not just the cookie. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = await currentToken();
  if (!token) return null;
  await connectDb();
  return findSessionUser(hashSessionToken(token));
});

/**
 * Guard for every protected route handler - proxy.ts already turns away
 * requests without a validly signed cookie, this is the authoritative check
 * (revoked/expired sessions, deleted users):
 *
 *   const denied = await requireApiSession();
 *   if (denied) return denied;
 */
export async function requireApiSession(): Promise<NextResponse | null> {
  if (await getSessionUser()) return null;
  // Drop the dead cookie so proxy.ts stops treating this browser as signed in.
  await clearSessionCookie();
  return NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

/** Creates a session for this browser and sets its cookie (Route Handlers only). */
export async function startSession(userId: string) {
  await connectDb();
  const requestHeaders = await headers();
  const { token, cookieValue } = issueSessionToken();
  await createSession(userId, hashSessionToken(token), {
    ip: clientIp(requestHeaders),
    userAgent: requestHeaders.get("user-agent") ?? "",
  });
  const { store, name, options } = await cookieContext();
  store.set(name, cookieValue, { ...options, maxAge: SESSION_MAX_AGE_MS / 1000 });
}

/** Deletes this browser's session (if any) and its cookie (Route Handlers only). */
export async function endSession() {
  const token = await currentToken();
  if (token) {
    await connectDb();
    await deleteSession(hashSessionToken(token));
  }
  await clearSessionCookie();
}

async function clearSessionCookie() {
  const { store, name, options } = await cookieContext();
  // Re-set with the same attributes rather than delete(): a __Host- cookie is
  // only replaced by a Set-Cookie that is itself Secure with Path=/.
  if (store.has(name)) store.set(name, "", { ...options, maxAge: 0 });
}
