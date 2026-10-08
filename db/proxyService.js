import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Proxy } from "./models/Proxy.js";

const execFileAsync = promisify(execFile);

const FAILURE_THRESHOLD = 3;
const POOL_CACHE_TTL_MS = 30_000;
const PROXY_URL_RE = /^(https?|socks[45]h?):\/\/\S+$/i;
const TEST_URL = "https://frontend-api-v3.pump.fun/coins-v3/So11111111111111111111111111111111111111112";

// Module-level cache, shared by every caller in this process (both the
// Next.js app and the standalone tracker daemon import db/pumpFunApi.js,
// which reads this pool on every price lookup) - same TTL-cache shape
// already used for coin info in db/pumpFunApi.js, just for the much
// smaller/slower-changing proxy list.
let poolCache = { proxies: [], expiresAt: 0 };

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
      { $inc: { consecutiveFailures: 1 }, $set: { lastError: errorMessage, lastCheckedAt: new Date() } },
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
    const { stdout } = await execFileAsync("curl", ["-s", "-m", "10", "-w", "\n%{http_code}", "--proxy", proxy.url, TEST_URL]);
    const status = Number(stdout.slice(stdout.lastIndexOf("\n") + 1).trim());
    if (!status) error = "No HTTP response through proxy";
    else if (PROXY_BROKEN_HTTP_STATUSES.has(status)) error = `HTTP ${status} through proxy (${status === 407 ? "proxy auth rejected" : "blocked by pump.fun"})`;
  } catch (err) {
    error = err.message;
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
