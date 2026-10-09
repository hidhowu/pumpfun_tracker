import crypto from "node:crypto";

/**
 * Session cookie crypto - no database access, so proxy.ts can use it on
 * every request. The cookie is "<token>.<HMAC-SHA256(SESSION_SECRET, token)>":
 * proxy.ts rejects anything not signed with our secret before it reaches a
 * route, and the route then checks the token against the Session collection
 * (db/authService.js) - only a SHA-256 of the token is ever stored there.
 */

const MIN_SECRET_LENGTH = 32;

function getSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function isSessionSecretConfigured(): boolean {
  return getSecret() !== null;
}

function sign(token: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(token).digest("base64url");
}

/** A fresh random 256-bit token plus the signed cookie value that carries it. */
export function issueSessionToken(): { token: string; cookieValue: string } {
  const secret = getSecret();
  if (!secret) throw new Error(`SESSION_SECRET is not set (or shorter than ${MIN_SECRET_LENGTH} characters)`);
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, cookieValue: `${token}.${sign(token, secret)}` };
}

/** The token inside a cookie value if its signature is ours, else null. */
export function verifySessionCookie(value: string | undefined): string | null {
  const secret = getSecret();
  if (!secret || !value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const token = value.slice(0, dot);
  const expected = Buffer.from(sign(token, secret));
  const actual = Buffer.from(value.slice(dot + 1));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? token : null;
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Over HTTPS the cookie is Secure and uses the __Host- prefix (browser-
 * enforced: Secure, Path=/, no Domain - so no subdomain or plain-HTTP page
 * can overwrite it). Over plain HTTP a Secure cookie would just be dropped,
 * so it falls back to a normal name there.
 */
export function sessionCookieName(https: boolean): string {
  return https ? "__Host-pft_session" : "pft_session";
}

/** Next.js always sets x-forwarded-proto (from the socket, or kept from a TLS-terminating reverse proxy). */
export function isHttpsRequest(headers: Headers): boolean {
  return (headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase() === "https";
}

/**
 * Best-effort client IP for login throttling: the right-most X-Forwarded-For
 * entry, i.e. the address the nearest proxy (or Next.js itself) saw. The
 * per-username limit doesn't depend on this being accurate.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return (forwarded?.at(-1) || headers.get("x-real-ip") || "").slice(0, 64);
}
