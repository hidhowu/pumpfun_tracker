import { NextResponse, type NextRequest } from "next/server";
import { isHttpsRequest, isSessionSecretConfigured, sessionCookieName, verifySessionCookie } from "@/lib/auth/token";

/**
 * First line of defense, on every request: deny by default. Every page and
 * every /api route - including ones added later - requires a validly signed
 * session cookie unless listed here. This is the cheap cookie-only check;
 * each route handler then verifies the session against the database
 * (lib/auth/session.ts's requireApiSession), so neither layer alone has to
 * be perfect.
 */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  // CSRF: a state-changing API call must come from this site's own pages.
  // (The cookie is also SameSite=Lax; this covers older browsers and same-site subdomains.)
  if (isApi && !SAFE_METHODS.has(request.method) && isCrossSite(request)) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (!isSessionSecretConfigured()) {
    return new NextResponse("Server misconfigured: SESSION_SECRET is not set (see .env.example).", { status: 500 });
  }

  const cookie = request.cookies.get(sessionCookieName(isHttpsRequest(request.headers)))?.value;
  if (verifySessionCookie(cookie)) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const login = new URL("/login", request.nextUrl);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

function isCrossSite(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  // Older browsers: fall back to comparing Origin with the host we were reached at.
  const origin = request.headers.get("origin");
  if (!origin) return false; // not a browser cross-site request (curl etc. still need a session)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export const config = {
  // Everything except Next's own static build output.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
