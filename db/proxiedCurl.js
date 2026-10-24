import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getActiveProxyPool, recordProxyResult, PROXY_BROKEN_HTTP_STATUSES, randomPumpUserAgent } from "./proxyService.js";

const execFileAsync = promisify(execFile);

const STATUS_MARKER = "\n__HTTP_STATUS__";
// How many different proxies to try (round-robin) before giving up on the
// pool entirely for this one call and falling straight through to a direct
// request - kept small so a call with several dead proxies in the pool
// doesn't compound their timeouts into one very slow lookup; the failure
// bookkeeping (db/proxyService.js) that decides blacklisting is cumulative
// across calls over time, so it doesn't need every call to exhaust the pool.
const MAX_PROXY_ATTEMPTS_PER_CALL = 2;
let proxyRoundRobinIndex = 0;

async function runCurl(url, proxyUrl, timeoutSec) {
  const args = ["-s", "-m", String(timeoutSec), "-A", randomPumpUserAgent(), "-w", `${STATUS_MARKER}%{http_code}`];
  if (proxyUrl) args.push("--proxy", proxyUrl);
  args.push(url);
  const { stdout } = await execFileAsync("curl", args);
  const markerIndex = stdout.lastIndexOf(STATUS_MARKER);
  const body = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
  const status = markerIndex >= 0 ? Number(stdout.slice(markerIndex + STATUS_MARKER.length).trim()) : 0;
  return { status, body };
}

/**
 * GET through curl, rotating through the proxies managed from the /proxies UI. Used for pump.fun's frontend API (db/pumpFunApi.js)
 * and for the price sources that rate-limit a single IP (Jupiter, DexScreener - db/onchainPrice.js, db/live/dexscreener.js).
 *
 * pump.fun's frontend API blocks Node's own `fetch` (undici) outright -
 * confirmed by testing: `curl` gets HTTP 200 reliably, while Node's `fetch`
 * gets HTTP 403 every single time even with a browser User-Agent set. That's
 * consistent with TLS/HTTP client fingerprinting (e.g. Cloudflare-style bot
 * protection) rather than a header check. Shelling out to curl (present by
 * default on Windows 10+ and any Unix box) is the pragmatic fix, since it
 * demonstrably isn't blocked. As of Oct 23 2026 Cloudflare also 403s curl's
 * own default User-Agent, so every call sends a random browser one
 * (randomPumpUserAgent, db/proxyService.js).
 *
 * Proxy-aware: with proxies configured, round-robins through them via
 * `curl --proxy`, retrying the next one on a
 * curl-level failure (couldn't connect, timed out, etc - NOT a legitimate
 * HTTP error from the server itself, which curl reports as a clean exit with
 * that status code, not a thrown error, so a real 404/500 is returned as-is
 * rather than treated as a proxy problem) AND on an HTTP 429 specifically -
 * that's a rate-limit tied to the proxy's own IP, and a different proxy has
 * its own separate limit, which is the entire point of rotating through a
 * pool rather than hammering one address. Every attempt's
 * outcome is recorded (db/proxyService.js) so a proxy that keeps genuinely
 * failing to connect gets auto-blacklisted out of future rotations - a 429
 * is recorded as a success (the proxy itself connected fine) so rate-limit
 * noise never counts toward that. If every attempt in this call fails or
 * gets rate-limited, or no proxies are configured at all, falls through to
 * a direct request - the same thing this function has always done - so a
 * proxy outage degrades to "no proxy" rather than ever blocking a price
 * lookup.
 *
 * @returns {Promise<{status: number, body: string}>}
 */
export async function curlGetJson(url, { timeoutSec = 10 } = {}) {
  const pool = await getActiveProxyPool().catch(() => []);
  if (pool.length === 0) return runCurl(url, null, timeoutSec);

  const attempts = Math.min(pool.length, MAX_PROXY_ATTEMPTS_PER_CALL);
  for (let i = 0; i < attempts; i++) {
    const proxy = pool[proxyRoundRobinIndex % pool.length];
    proxyRoundRobinIndex++;
    try {
      const result = await runCurl(url, proxy.url, timeoutSec);
      if (!result.status || PROXY_BROKEN_HTTP_STATUSES.has(result.status)) {
        // Connected to the proxy, but it relayed no usable answer
        // (auth rejected / IP blocked) - that's this proxy failing, not the server.
        recordProxyResult(proxy._id, false, `HTTP ${result.status || "no response"} through proxy`).catch(() => {});
        continue;
      }
      recordProxyResult(proxy._id, true).catch(() => {}); // fire-and-forget - never let bookkeeping slow down the actual response
      if (result.status === 429) continue; // this proxy's IP is rate-limited right now - immediately try the next one instead of giving up
      return result;
    } catch (err) {
      recordProxyResult(proxy._id, false, err.message).catch(() => {});
    }
  }
  // Every proxy tried for this call either failed outright or came back
  // 429 - this IS the request the caller is waiting on, so it's awaited
  // normally, errors and all.
  return runCurl(url, null, timeoutSec);
}
