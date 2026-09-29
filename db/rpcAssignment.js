import { RpcEndpoint } from "./models/RpcEndpoint.js";
import { Trader } from "./models/Trader.js";
import { logEvent } from "./systemLog.js";

// How long an endpoint can sit disconnected before its addresses get
// redistributed to whichever other endpoints are actually healthy, rather
// than sitting untracked waiting for it to come back. It naturally rejoins
// the pool (and starts absorbing its fair share again, via the normal even-
// target logic below) the moment it reconnects - nothing special-cased.
const STUCK_THRESHOLD_MS = 60 * 1000;

function isEndpointAvailable(endpoint) {
  if (!endpoint.enabled) return false;
  if (endpoint.status === "connected") return true;
  if (!endpoint.lastDisconnectedAt) return true; // never even had a chance to fail yet - give it the benefit of the doubt
  return Date.now() - new Date(endpoint.lastDisconnectedAt).getTime() < STUCK_THRESHOLD_MS;
}

/**
 * One-time seed: if no RpcEndpoint documents exist yet, create one per URL
 * in `seedUrls` (the daemon passes its .env-derived WS URL list). After
 * this runs once, .env's SOLANA_WS_URLS is no longer consulted - endpoints
 * are managed from the /rpc UI from here on. Safe to call on every daemon
 * startup: a no-op once the collection is non-empty.
 */
export async function ensureRpcEndpointsSeeded(seedUrls) {
  const count = await RpcEndpoint.countDocuments({});
  if (count > 0) return;
  const urls = [...new Set((seedUrls || []).filter(Boolean))];
  if (urls.length === 0) return;
  await RpcEndpoint.insertMany(
    urls.map((url) => ({ url })),
    { ordered: false }
  ).catch(() => {}); // a concurrent seed racing this is harmless - unique index on url dedupes
}

/**
 * Even-but-stable load balancer. Every active endpoint gets a target count
 * (total active traders / endpoint count, remainder spread across the
 * earliest-created endpoints) - a trader already on an endpoint that's at or
 * under its target stays put (this is what keeps a *steady* state from
 * thrashing: nothing moves just because a poll ran). Only the excess above
 * each over-target endpoint gets pulled and handed to whichever endpoint is
 * still under its target - which is exactly what makes adding a new
 * endpoint actually pull load onto it (e.g. 108 addresses on 1 endpoint,
 * add a 2nd -> both land on ~54, not "108 and 0"), and what makes deleting/
 * disabling one redistribute its addresses across the rest.
 *
 * An enabled endpoint that's been disconnected for over STUCK_THRESHOLD_MS
 * is treated as unavailable here (excluded from `activeUrls`) even though
 * it's still "enabled" - its addresses fall into the same redistribution
 * pool as a deleted/disabled endpoint's would, and it rejoins normally
 * (absorbing its fair share again via the even-target logic) the moment it
 * reconnects. The daemon keeps retrying it in the background the whole
 * time regardless (see LogSubscriber's own reconnect/watchdog logic) -
 * this function only decides where NEW work gets placed, it never tears
 * down a live connection attempt.
 *
 * Persists every change and returns the diff so the caller (TrackerService)
 * knows exactly which addresses to watch()/unwatch() and where.
 *
 * @returns {Promise<{moves: Array<{address:string, fromUrl:string|null, toUrl:string}>, unresolved: string[]}>}
 */
export async function rebalanceAssignments() {
  const allEndpoints = await RpcEndpoint.find({}, { url: 1, enabled: 1, status: 1, lastDisconnectedAt: 1 })
    .sort({ createdAt: 1 })
    .lean();
  const endpoints = allEndpoints.filter(isEndpointAvailable);
  const activeUrls = endpoints.map((e) => e.url);
  const stuckUrls = allEndpoints.filter((e) => e.enabled && !isEndpointAvailable(e)).map((e) => e.url);
  const traders = await Trader.find({ status: "active" }, { address: 1, assignedRpcUrl: 1 }).lean();

  if (activeUrls.length === 0) {
    const unresolved = traders.map((t) => t.address);
    if (unresolved.length) {
      await Trader.updateMany({ address: { $in: unresolved } }, { $set: { subscriptionStatus: "failed" } });
      logEvent("rpc", `No active RPC endpoints - ${unresolved.length} address(es) cannot be tracked`, { level: "error" });
    }
    return { moves: [], unresolved };
  }

  const originalUrlByAddress = new Map(traders.map((t) => [t.address, t.assignedRpcUrl]));
  const activeUrlSet = new Set(activeUrls);

  // Bucket every active trader under its current endpoint, or "unassigned" if that endpoint isn't active anymore.
  const byUrl = new Map(activeUrls.map((url) => [url, []]));
  const pool = [];
  for (const trader of traders) {
    if (trader.assignedRpcUrl && activeUrlSet.has(trader.assignedRpcUrl)) {
      byUrl.get(trader.assignedRpcUrl).push(trader.address);
    } else {
      pool.push(trader.address);
    }
  }

  // Even target per endpoint, in stable (creation-order) preference for who absorbs the remainder.
  const total = traders.length;
  const n = activeUrls.length;
  const base = Math.floor(total / n);
  const remainder = total % n;
  const targetByUrl = new Map(activeUrls.map((url, idx) => [url, base + (idx < remainder ? 1 : 0)]));

  // Pull the excess off any endpoint currently above its target.
  for (const url of activeUrls) {
    const list = byUrl.get(url);
    const target = targetByUrl.get(url);
    while (list.length > target) pool.push(list.pop());
  }

  // Fill every endpoint currently below its target from the pool.
  for (const url of activeUrls) {
    const list = byUrl.get(url);
    const target = targetByUrl.get(url);
    while (list.length < target && pool.length > 0) list.push(pool.pop());
  }
  // Rounding leftovers (shouldn't normally happen) go wherever's smallest right now.
  while (pool.length > 0) {
    let bestUrl = activeUrls[0];
    for (const url of activeUrls) {
      if (byUrl.get(url).length < byUrl.get(bestUrl).length) bestUrl = url;
    }
    byUrl.get(bestUrl).push(pool.pop());
  }

  const moves = [];
  for (const url of activeUrls) {
    for (const address of byUrl.get(url)) {
      const fromUrl = originalUrlByAddress.get(address) ?? null;
      if (fromUrl !== url) moves.push({ address, fromUrl, toUrl: url });
    }
  }

  if (moves.length > 0) {
    await Trader.bulkWrite(
      moves.map((m) => ({
        updateOne: {
          filter: { address: m.address },
          update: { $set: { assignedRpcUrl: m.toUrl, subscriptionStatus: "pending" } },
        },
      }))
    );

    const movedOffStuck = moves.filter((m) => m.fromUrl && stuckUrls.includes(m.fromUrl));
    if (movedOffStuck.length > 0) {
      logEvent(
        "rpc",
        `${stuckUrls.length} RPC endpoint(s) have been disconnected for over ${STUCK_THRESHOLD_MS / 1000}s - redistributed ${movedOffStuck.length} address(es) to healthy endpoints: ${stuckUrls.join(", ")}`,
        { level: "warn", meta: { stuckUrls, redistributedCount: movedOffStuck.length } }
      );
    }
  }

  return { moves, unresolved: [] };
}

export async function markSubscribed(address, url) {
  await Trader.updateOne({ address, assignedRpcUrl: url }, { $set: { subscriptionStatus: "subscribed" } });
}

export async function markSubscriptionFailed(address) {
  await Trader.updateOne({ address }, { $set: { subscriptionStatus: "failed" } });
}
