import { execCurl } from "./curlBinary.js";
import { Proxy } from "./models/Proxy.js";

const FAILURE_THRESHOLD = 3;
const POOL_CACHE_TTL_MS = 30_000;
const PROXY_URL_RE = /^(https?|socks[45]h?):\/\/\S+$/i;
const TEST_URL = "https://frontend-api-v3.pump.fun/coins-v3/So11111111111111111111111111111111111111112";

/**
 * Every curl call to pump.fun sends one of these User-Agents, picked at random per request (randomPumpUserAgent) so no single UA
 * string becomes a fingerprint. Cloudflare in front of pump.fun answers curl's default "curl/x.y" UA with a 403 "Just a moment..."
 * challenge (direct or through any proxy); each of these real browser strings got 200s through a proxy with no 403 (tested Oct 23
 * 2026). Add to the list only after testing a string the same way.
 */
const PUMP_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
];

/** A random browser User-Agent for one curl call to pump.fun. */
export function randomPumpUserAgent() {
  return PUMP_USER_AGENTS[Math.floor(Math.random() * PUMP_USER_AGENTS.length)];
}

// Module-level cache, shared by every caller in this process (both the
// Next.js app and the standalone tracker daemon import db/pumpFunApi.js,
// which reads this pool on every price lookup) - same TTL-cache shape
// already used for coin info in db/pumpFunApi.js, just for the much
// smaller/slower-changing proxy list.
let poolCache = { proxies: [], expiresAt: 0 };

// "scheme://user:secret@" -> "scheme://user:****@", anywhere in a string.
const URL_CREDENTIALS_RE = /\b([a-z][a-z0-9+.-]*:\/\/[^:@/\s]+):[^\s]*@/gi;

/** Masks the password in any URL inside `text` - for error messages, which echo curl's full command line. */
export function redactCredentials(text) {
  return typeof text === "string" ? text.replace(URL_CREDENTIALS_RE, "$1:****@") : text;
}

/** A proxy as sent to the browser: the URL's password never leaves the server. */
export function toProxyView(proxy) {
  return { ...proxy, url: redactCredentials(proxy.url), lastError: redactCredentials(proxy.lastError) };
}

/** Enabled AND currently-healthy (non-blacklisted) proxies, round-robin candidates. */
export async function getActiveProxyPool() {
  if (poolCache.expiresAt > Date.now()) return poolCache.proxies;
  const proxies = await Proxy.find({ enabled: true, status: "active" }).lean();
  poolCache = { proxies, expiresAt: Date.now() + POOL_CACHE_TTL_MS };
  return proxies;
}

/** Forces the next getActiveProxyPool() call to re-read from Mongo - used right after a write that should take effect immediately (blacklist, manual test, enable/disable). */
export function invalidateProxyPoolCache() {
  poolCache = { proxies: [], expiresAt: 0 };
}

/**
 * Records one proxy use's outcome. Best-effort and never throws - this is
 * bookkeeping, not the actual request the caller is waiting on, so a
 * failure here must never surface as a failure of that request.
 *
 * A success always resets the failure streak and clears a blacklist (used
 * both by curlGetJson's automatic rotation AND the manual "Test" button in
 * the UI - a real success is a real success regardless of which path
 * triggered it). A failure increments the streak and, once it reaches
 * FAILURE_THRESHOLD, blacklists the proxy so future pool reads skip it
 * automatically.
 */
export async function recordProxyResult(proxyId, ok, errorMessage = null) {
  try {
    if (ok) {
      const updated = await Proxy.findOneAndUpdate(
        { _id: proxyId },
        {
          $set: {
            consecutiveFailures: 0,
            status: "active",
            lastSuccessAt: new Date(),
            lastCheckedAt: new Date(),
            lastError: null,
          },
        },
        { returnDocument: "after" }
      );
      if (updated) invalidateProxyPoolCache(); // e.g. this just un-blacklisted it - reflect immediately, not after the TTL
      return;
    }

    const updated = await Proxy.findOneAndUpdate(
      { _id: proxyId },
      { $inc: { consecutiveFailures: 1 }, $set: { lastError: redactCredentials(errorMessage), lastCheckedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (updated && updated.consecutiveFailures >= FAILURE_THRESHOLD && updated.status !== "blacklisted") {
      await Proxy.updateOne({ _id: proxyId }, { $set: { status: "blacklisted" } });
      invalidateProxyPoolCache();
    }
  } catch {
    // best-effort only - see doc comment above
  }
}

/**
 * Bulk add, same shape/conventions as db/traderService.js's addTradersBulk:
 * duplicates (already-registered URLs, including repeats within the same
 * submitted list) are silently skipped into `skipped`, malformed entries
 * are rejected into `invalid`, and everything else is inserted.
 */
export async function addProxiesBulk(urls) {
  const normalized = urls.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean);
  const invalid = normalized.filter((u) => !PROXY_URL_RE.test(u));
  const valid = normalized.filter((u) => PROXY_URL_RE.test(u));

  const deduped = [...new Set(valid)];
  const existingDocs = await Proxy.find({ url: { $in: deduped } }, { url: 1 }).lean();
  const existingUrls = new Set(existingDocs.map((d) => d.url));

  const toInsert = deduped.filter((u) => !existingUrls.has(u));
  const skipped = deduped.filter((u) => existingUrls.has(u));

  let added = [];
  if (toInsert.length > 0) {
    const docs = await Proxy.insertMany(
      toInsert.map((url) => ({ url })),
      { ordered: false }
    );
    added = docs.map((d) => d.url);
    invalidateProxyPoolCache();
  }

  return { added, skipped, invalid };
}

/** Bulk delete by id. */
export async function deleteProxiesBulk(ids) {
  const result = await Proxy.deleteMany({ _id: { $in: ids } });
  invalidateProxyPoolCache();
  return result.deletedCount || 0;
}

/**
 * Live connectivity check for exactly one proxy (the /proxies UI's "Test"
 * button) - a real curl call through it against pump.fun's own API, so this
 * exercises the identical path curlGetJson uses, not just a generic
 * reachability ping. Records the outcome the same way an automatic use
 * would (recordProxyResult), so a passing test both reports success AND
 * un-blacklists the proxy if it had been - which is the whole point of the
 * button, not a side effect.
 */
/**
 * HTTP statuses that, coming back THROUGH a proxy, mean the proxy itself is
 * unusable for pump.fun rather than pump.fun answering normally: 407 = the
 * proxy rejected our credentials, 403 = pump.fun's bot protection has
 * blocked that proxy's IP. Anything else (200, 404, 429, 5xx) proves the
 * proxy connected and relayed a real pump.fun response.
 */
export const PROXY_BROKEN_HTTP_STATUSES = new Set([403, 407]);

/**
 * `enableOnSuccess` also flips a manually-disabled proxy back on when it
 * passes - used by the bulk "re-test" action on /proxies.
 */
export async function testProxy(proxyId, { enableOnSuccess = false } = {}) {
  const proxy = await Proxy.findById(proxyId);
  if (!proxy) throw new Error("Proxy not found");

  let error = null;
  try {
    // No -o (output file) flag here, deliberately - "/dev/null" is a Unix
    // path and this app also runs on Windows, where curl has no such device
    // to write to; letting execFile just capture stdout into memory (small,
    // one JSON/error body) works identically on both. -w appends the HTTP
    // status, which is what actually decides pass/fail: curl exits 0 for
    // ANY HTTP response, including a 403 from pump.fun blocking this IP.
    const { stdout } = await execCurl(["-s", "-m", "10", "-w", "\n%{http_code}", "--proxy", proxy.url, TEST_URL], { fallbackUserAgent: randomPumpUserAgent() });
    const status = Number(stdout.slice(stdout.lastIndexOf("\n") + 1).trim());
    if (!status) error = "No HTTP response through proxy";
    else if (PROXY_BROKEN_HTTP_STATUSES.has(status)) error = `HTTP ${status} through proxy (${status === 407 ? "proxy auth rejected" : "blocked by pump.fun"})`;
  } catch (err) {
    error = redactCredentials(err.message);
  }

  if (error) {
    await recordProxyResult(proxy._id, false, error);
    return { ok: false, error, proxy: await Proxy.findById(proxyId) };
  }
  await recordProxyResult(proxy._id, true);
  if (enableOnSuccess && !proxy.enabled) {
    await Proxy.updateOne({ _id: proxy._id }, { $set: { enabled: true } });
    invalidateProxyPoolCache();
  }
  return { ok: true, error: null, proxy: await Proxy.findById(proxyId) };
}
