import { RpcEndpoint } from "./models/RpcEndpoint.js";
import { HttpRpcEndpoint } from "./models/HttpRpcEndpoint.js";
import { logEvent } from "./systemLog.js";

/** Rate-limit failures in a row before an endpoint is blacklisted - same rule as db/proxyService.js. */
export const RPC_FAILURE_THRESHOLD = 3;

const PROBE_TIMEOUT_MS = 10_000;
const BURST_SIZE = 10; // concurrent requests fired at an HTTP endpoint to see whether it rate-limits
const WS_BURST_SIZE = 5; // concurrent logsSubscribe calls fired at a WebSocket endpoint
const SLOW_MS = 1500; // median latency above this is flagged as slow
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"; // any valid address works - this one is what the tracker watches anyway

const RATE_LIMIT_RE = /rate.?limit|too many|throttl|exceeded|\b429\b/i;
const modelFor = (kind) => (kind === "ws" ? RpcEndpoint : HttpRpcEndpoint);

/** Provider URLs usually embed an API key - never put one in a log line or error message. */
export function hostOf(url) {
  try {
    return new URL(url.replace(/^wss?:/i, "https:")).host;
  } catch {
    return "rpc";
  }
}

/** True for an error message that means "the provider is throttling us" - the only automatic strike. */
export function isRateLimitMessage(message) {
  return RATE_LIMIT_RE.test(String(message || ""));
}

/**
 * Records one use (or test) of an endpoint, found by URL since that's what the daemon's pools know.
 * Best-effort and never throws - bookkeeping must not fail the request the caller is waiting on.
 *
 * A success clears the failure streak and any blacklist. A failure adds a strike; the third in a row
 * blacklists the endpoint, so pools skip it until a test (or a later real call) succeeds. The last
 * usable WebSocket endpoint is never auto-blacklisted - that would stop all address tracking. (HTTP
 * endpoints don't need this guard: .env's SOLANA_RPC_URLS is always kept as a floor.)
 *
 * `stamp` also writes lastCheckedAt/lastSuccessAt - for manual tests; automatic calls skip it so a
 * busy pool isn't writing on every request.
 *
 * @returns {Promise<{blacklisted: boolean}>} blacklisted = this call is the one that blacklisted it
 */
export async function recordRpcResult(kind, url, ok, { error = null, stamp = false } = {}) {
  try {
    const Model = modelFor(kind);
    if (ok) {
      const now = new Date();
      const filter = stamp ? { url } : { url, $or: [{ consecutiveFailures: { $gt: 0 } }, { health: "blacklisted" }] };
      const before = await Model.findOneAndUpdate(
        filter,
        { $set: { consecutiveFailures: 0, health: "active", blacklistedAt: null, lastError: null, ...(stamp ? { lastCheckedAt: now, lastSuccessAt: now } : {}) } },
        { returnDocument: "before", projection: { health: 1 } }
      );
      if (before?.health === "blacklisted") logEvent("rpc", `RPC un-blacklisted: ${hostOf(url)}`, { meta: { url: hostOf(url), kind } });
      return { blacklisted: false };
    }

    const updated = await Model.findOneAndUpdate(
      { url },
      { $inc: { consecutiveFailures: 1 }, $set: { lastError: error, lastCheckedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!updated || updated.health === "blacklisted" || updated.consecutiveFailures < RPC_FAILURE_THRESHOLD) return { blacklisted: false };

    if (kind === "ws") {
      const others = await RpcEndpoint.countDocuments({ enabled: true, health: { $ne: "blacklisted" }, url: { $ne: url } });
      if (others === 0) return { blacklisted: false };
    }
    await Model.updateOne({ url }, { $set: { health: "blacklisted", blacklistedAt: new Date() } });
    logEvent("rpc", `RPC blacklisted after ${updated.consecutiveFailures} failures in a row: ${hostOf(url)} - ${error || "no detail"}`, {
      level: "warn",
      meta: { url: hostOf(url), kind },
    });
    return { blacklisted: true };
  } catch {
    return { blacklisted: false };
  }
}

// ----------------------------------------------------------------- tests

const median = (nums) => {
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

/** One JSON-RPC POST. Resolves with what came back (never throws on an HTTP error status); rejects on network failure/timeout. */
async function postRpc(url, method, params = []) {
  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const ms = Math.round(performance.now() - started);
  const json = await res.json().catch(() => null);
  const limited = res.status === 429 || (json?.error && (json.error.code === 429 || isRateLimitMessage(json.error.message)));
  return { status: res.status, ok: res.ok && !json?.error, limited: Boolean(limited), json, ms };
}

const networkMessage = (err) => (err?.name === "TimeoutError" ? `no answer within ${PROBE_TIMEOUT_MS / 1000}s` : err?.cause?.code || err?.message || "request failed");

/**
 * Live check of an HTTP JSON-RPC endpoint: one getSlot probe (reachable? key valid? how fast?), then a
 * burst of BURST_SIZE concurrent getSlot calls to see whether the provider's rate limit kicks in -
 * which is what actually breaks live tracking, and the sign an endpoint needs a paid plan.
 */
export async function testHttpRpc(url) {
  let probe;
  try {
    probe = await postRpc(url, "getSlot");
  } catch (err) {
    return { ok: false, verdict: "unreachable", latencyMs: null, message: `Unreachable: ${networkMessage(err)}` };
  }
  if (probe.limited) {
    return { ok: false, verdict: "rate_limited", latencyMs: probe.ms, message: "Rate limited on the very first request - the plan's limit is already used up or too low. Probably needs upgrading." };
  }
  if (probe.status === 401 || probe.status === 403) {
    return { ok: false, verdict: "auth_failed", latencyMs: probe.ms, message: `HTTP ${probe.status} - the API key was rejected or this IP/method is blocked` };
  }
  if (!probe.ok) {
    const detail = probe.json?.error ? `RPC error ${probe.json.error.code}: ${probe.json.error.message}` : `HTTP ${probe.status}`;
    return { ok: false, verdict: "error", latencyMs: probe.ms, message: detail };
  }

  const burst = await Promise.all(Array.from({ length: BURST_SIZE }, () => postRpc(url, "getSlot").catch(() => null)));
  const limited = burst.filter((r) => r?.limited).length;
  const failed = burst.filter((r) => !r || (!r.ok && !r.limited)).length;
  const medianMs = median(burst.filter((r) => r?.ok).map((r) => r.ms)) ?? probe.ms;

  if (limited > 0) {
    return {
      ok: false,
      verdict: "rate_limited",
      latencyMs: medianMs,
      message: `Rate limited: ${limited} of ${BURST_SIZE} quick back-to-back requests were refused. Probably needs upgrading (or spread the load across more endpoints).`,
    };
  }
  if (failed > BURST_SIZE / 2) {
    return { ok: false, verdict: "error", latencyMs: medianMs, message: `${failed} of ${BURST_SIZE} test requests failed or timed out` };
  }
  if (medianMs > SLOW_MS) {
    return { ok: true, verdict: "slow", latencyMs: medianMs, message: `Works, but slow (${medianMs} ms median) - fine for backtests, risky for live trade detection` };
  }
  return { ok: true, verdict: "ok", latencyMs: medianMs, message: `Healthy - ${BURST_SIZE}/${BURST_SIZE} burst requests answered, ${medianMs} ms median` };
}

/**
 * Live check of a WebSocket endpoint: opens a connection, fires WS_BURST_SIZE concurrent logsSubscribe
 * calls (what the tracker does per address), flags rate-limit refusals, then unsubscribes and closes.
 */
export function testWsRpc(url) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const subIds = [];
    let answered = 0;
    let limited = 0;
    let otherError = null;
    const started = performance.now();
    let openMs = null;
    let subscribeStarted = 0;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        for (const id of subIds) socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1000 + id, method: "logsUnsubscribe", params: [id] }));
        socket.close();
      } catch {
        // already closed - nothing to clean up
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(
        openMs === null
          ? { ok: false, verdict: "unreachable", latencyMs: null, message: `Could not open a WebSocket within ${PROBE_TIMEOUT_MS / 1000}s` }
          : { ok: false, verdict: "error", latencyMs: openMs, message: `Connected, but only ${answered} of ${WS_BURST_SIZE} subscribe calls were answered in time` }
      );
    }, PROBE_TIMEOUT_MS);

    try {
      socket = new WebSocket(url);
    } catch (err) {
      finish({ ok: false, verdict: "error", latencyMs: null, message: `Invalid WebSocket URL: ${err.message}` });
      return;
    }

    socket.addEventListener("open", () => {
      openMs = Math.round(performance.now() - started);
      subscribeStarted = performance.now();
      for (let i = 1; i <= WS_BURST_SIZE; i++) {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: i, method: "logsSubscribe", params: [{ mentions: [PUMP_PROGRAM] }, { commitment: "processed" }] }));
      }
    });
    socket.addEventListener("error", () => {
      if (openMs !== null) return; // a late error after connecting - the answers/timeout decide
      finish({
        ok: false,
        verdict: "unreachable",
        latencyMs: null,
        message: "Could not open the WebSocket - unreachable, or the provider refused the connection (a 429/403 on connect looks like this)",
      });
    });
    socket.addEventListener("close", () => {
      if (settled) return;
      finish({ ok: false, verdict: "error", latencyMs: openMs, message: "Connection closed by the provider before the test finished" });
    });
    socket.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof msg.id !== "number" || msg.id > WS_BURST_SIZE) return;
      answered += 1;
      if (msg.error) {
        if (msg.error.code === 429 || isRateLimitMessage(msg.error.message)) limited += 1;
        else otherError ??= `RPC error ${msg.error.code}: ${msg.error.message}`;
      } else if (typeof msg.result === "number") {
        subIds.push(msg.result);
      }
      if (answered < WS_BURST_SIZE) return;

      const subscribeMs = Math.round((performance.now() - subscribeStarted) / WS_BURST_SIZE);
      if (limited > 0) {
        finish({ ok: false, verdict: "rate_limited", latencyMs: openMs, message: `Rate limited: ${limited} of ${WS_BURST_SIZE} quick subscribe calls were refused. Probably needs upgrading.` });
      } else if (otherError) {
        finish({ ok: false, verdict: "error", latencyMs: openMs, message: otherError });
      } else if (openMs > SLOW_MS) {
        finish({ ok: true, verdict: "slow", latencyMs: openMs, message: `Works, but connecting took ${openMs} ms` });
      } else {
        finish({ ok: true, verdict: "ok", latencyMs: openMs, message: `Healthy - connected in ${openMs} ms, ${WS_BURST_SIZE}/${WS_BURST_SIZE} subscribe calls answered (~${subscribeMs} ms each)` });
      }
    });
  });
}

/** Tests an endpoint by URL without touching the DB - used by the Add dialog before anything is saved. */
export function probeRpcUrl(kind, url) {
  return kind === "ws" ? testWsRpc(url) : testHttpRpc(url);
}

/**
 * Tests one stored endpoint and records the outcome: a pass clears its strikes and un-blacklists it (also
 * re-enabling it with enableOnSuccess); a fail adds a strike, and the third in a row blacklists it.
 * Returns the refreshed document.
 */
export async function testRpcEndpoint(kind, id, { enableOnSuccess = false } = {}) {
  const Model = modelFor(kind);
  const endpoint = await Model.findById(id);
  if (!endpoint) throw new Error("RPC endpoint not found");

  const result = await probeRpcUrl(kind, endpoint.url);
  await recordRpcResult(kind, endpoint.url, result.ok, { error: result.ok ? null : result.message, stamp: true });
  const set = { lastTest: { at: new Date(), verdict: result.verdict, latencyMs: result.latencyMs, message: result.message } };
  if (result.ok && enableOnSuccess && !endpoint.enabled) set.enabled = true;
  const updated = await Model.findByIdAndUpdate(id, { $set: set }, { returnDocument: "after" });
  return { ...result, endpoint: updated };
}
