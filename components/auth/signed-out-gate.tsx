"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Rendered by the root layout when there's no valid session. On /login it's
 * a pass-through; anywhere else (e.g. a session revoked since proxy.ts last
 * saw its cookie) it sends the browser to sign in instead of rendering a page
 * that would only fail its API calls.
 */
export function SignedOutGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onLogin = pathname === "/login";

  useEffect(() => {
    if (!onLogin) window.location.replace(`/login?next=${encodeURIComponent(pathname + window.location.search)}`);
  }, [onLogin, pathname]);

  return onLogin ? children : null;
}
