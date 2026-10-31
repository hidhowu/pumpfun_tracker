import { RpcEndpoint } from "./models/RpcEndpoint.js";
import { HttpRpcEndpoint } from "./models/HttpRpcEndpoint.js";
import { logEvent } from "./systemLog.js";

/** Rate-limit failures in a row before an endpoint is blacklisted - same rule as db/proxyService.js. */
export const RPC_FAILURE_THRESHOLD = 3;

const PROBE_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5; // a test stops at the first success, so a healthy endpoint costs one request
const RETRY_DELAY_MS = 1500; // pause after a failed attempt so a rate limit has time to clear before the next one
const SLOW_MS = 1500; // median latency above this is flagged as slow
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"; // only used for the logsSubscribe fallback on WebSocket endpoints
// Same options the tracker passes to getTransaction (src/parseTransaction.js).
const TX_OPTIONS = { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" };

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The known-good transaction signature every test fetches - set RPC_TEST_SIGNATURE in .env. */
const testSignature = () => (process.env.RPC_TEST_SIGNATURE || "").trim();

const NO_SIGNATURE_RESULT = {
  ok: false,
  verdict: "no_signature",
  latencyMs: null,
  message: "No test transaction configured - set RPC_TEST_SIGNATURE in .env to a signature of a real transaction and restart",
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
  return { status: res.status, json, ms };
}

const networkMessage = (err) => (err?.name === "TimeoutError" ? `no answer within ${PROBE_TIMEOUT_MS / 1000}s` : err?.cause?.code || err?.message || "request failed");

/**
 * Turns one getTransaction answer into an attempt outcome. Only a non-null result counts as a pass: the endpoint
 * must actually return the transaction, which is the call the tracker depends on.
 * state: ok | limited | auth | unsupported | notfound | error
 */
function classifyAnswer({ status, json, ms }) {
  const err = json?.error;
  if (status === 429 || err?.code === 429 || (err && isRateLimitMessage(err.message))) return { state: "limited", ms, message: "rate limited" };
  if (status === 401 || status === 403) return { state: "auth", ms, message: `HTTP ${status} - the API key was rejected or this IP/method is blocked` };
  if (err?.code === -32601) return { state: "unsupported", ms, message: `${err.message}` };
  if (err) return { state: "error", ms, message: `RPC error ${err.code}: ${err.message}` };
  if (status < 200 || status >= 300) return { state: "error", ms, message: `HTTP ${status}` };
  if (!json || json.result === undefined) return { state: "error", ms, message: "answer was not a JSON-RPC response" };
  if (json.result === null) return { state: "notfound", ms, message: "answered, but doesn't have the test transaction (too old for this node's history?)" };
  return { state: "ok", ms };
}

const VERDICT_OF_STATE = { limited: "rate_limited", auth: "auth_failed", unreachable: "unreachable" };

/**
 * Runs `attempt` up to MAX_ATTEMPTS times, RETRY_DELAY_MS apart, and stops at the first pass. One pass is enough to
 * call an endpoint working - failures before it (a rate limit, a hiccup) are not held against it. Only when every
 * attempt fails does the endpoint fail the test, with the last attempt's reason as the verdict.
 */
async function runAttempts(attempt) {
  const failures = [];
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const outcome = await attempt();
    if (outcome.state === "ok") {
      const slow = outcome.ms > SLOW_MS;
      const earlier = failures.length ? ` (${failures.length} earlier ${failures.length === 1 ? "attempt" : "attempts"} failed - last: ${failures[failures.length - 1].message})` : "";
      return {
        ok: true,
        verdict: slow ? "slow" : "ok",
        latencyMs: outcome.ms,
        message: `${slow ? "Works, but slow - " : "Healthy - "}fetched the test transaction on attempt ${n} of ${MAX_ATTEMPTS} in ${outcome.ms} ms${earlier}`,
      };
    }
    failures.push(outcome);
    if (n < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  const last = failures[failures.length - 1];
  const limitedCount = failures.filter((f) => f.state === "limited").length;
  const detail =
    last.state === "limited"
      ? `rate limited on ${limitedCount} of ${MAX_ATTEMPTS} attempts even with ${RETRY_DELAY_MS / 1000}s between them - the plan's limit is too low or used up`
      : last.message;
  return {
    ok: false,
    verdict: VERDICT_OF_STATE[last.state] ?? "error",
    latencyMs: last.ms ?? null,
    message: `All ${MAX_ATTEMPTS} attempts failed, ${RETRY_DELAY_MS / 1000}s apart - ${detail}`,
  };
}

/**
 * Live check of an HTTP JSON-RPC endpoint: fetch a known transaction (RPC_TEST_SIGNATURE) with getTransaction -
 * one success within MAX_ATTEMPTS spaced-out tries means the endpoint works.
 */
export async function testHttpRpc(url) {
  const signature = testSignature();
  if (!signature) return NO_SIGNATURE_RESULT;
  return runAttempts(async () => {
    try {
      return classifyAnswer(await postRpc(url, "getTransaction", [signature, TX_OPTIONS]));
    } catch (err) {
      return { state: "unreachable", message: `unreachable: ${networkMessage(err)}` };
    }
  });
}

/** A lazily-opened WebSocket that answers one JSON-RPC request at a time and reconnects if the provider drops it. */
function createWsSession(url) {
  let socket = null;
  let nextId = 1;
  const pending = new Map();

  const failPending = (message) => {
    for (const { reject } of pending.values()) reject(Object.assign(new Error(message), { state: "error" }));
    pending.clear();
  };

  const connect = () =>
    new Promise((resolve, reject) => {
      let ws;
      const unreachable = (message) => reject(Object.assign(new Error(message), { state: "unreachable" }));
      try {
        ws = new WebSocket(url);
      } catch (err) {
        unreachable(`invalid WebSocket URL: ${err.message}`);
        return;
      }
      const timer = setTimeout(() => {
        unreachable(`could not open a WebSocket within ${PROBE_TIMEOUT_MS / 1000}s`);
        ws.close();
      }, PROBE_TIMEOUT_MS);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        socket = ws;
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        if (socket !== ws) unreachable("could not open the WebSocket - unreachable, or the provider refused the connection (a 429/403 on connect looks like this)");
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        if (socket === ws) {
          socket = null;
          failPending("connection closed by the provider");
        } else {
          unreachable("connection closed before it opened");
        }
      });
      ws.addEventListener("message", (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        const waiting = pending.get(msg.id);
        if (!waiting) return;
        pending.delete(msg.id);
        waiting.resolve({ status: 200, json: msg, ms: Math.round(performance.now() - waiting.started) });
      });
    });

  return {
    async request(method, params) {
      if (!socket) await connect();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Object.assign(new Error(`no answer within ${PROBE_TIMEOUT_MS / 1000}s`), { state: "error" }));
        }, PROBE_TIMEOUT_MS);
        pending.set(id, {
          started: performance.now(),
          resolve: (value) => (clearTimeout(timer), resolve(value)),
          reject: (err) => (clearTimeout(timer), reject(err)),
        });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },
    close() {
      try {
        socket?.close();
      } catch {
        // already closed - nothing to clean up
      }
    },
  };
}

/**
 * Live check of a WebSocket endpoint, the same way as HTTP: getTransaction for the test signature over the socket.
 * Some providers only expose subscriptions on their WS gateway ("Method not found" for everything else), so for
 * those a successful logsSubscribe - what the tracker uses this endpoint for - counts as the pass instead.
 */
export async function testWsRpc(url) {
  const signature = testSignature();
  if (!signature) return NO_SIGNATURE_RESULT;
  const session = createWsSession(url);
  try {
    return await runAttempts(async () => {
      try {
        const answer = classifyAnswer(await session.request("getTransaction", [signature, TX_OPTIONS]));
        if (answer.state !== "unsupported") return answer;

        const subscribed = await session.request("logsSubscribe", [{ mentions: [PUMP_PROGRAM] }, { commitment: "processed" }]);
        if (typeof subscribed.json?.result === "number") {
          await session.request("logsUnsubscribe", [subscribed.json.result]).catch(() => null);
          return { state: "ok", ms: subscribed.ms };
        }
        const failed = classifyAnswer(subscribed);
        return failed.state === "ok" ? { state: "error", ms: subscribed.ms, message: "logsSubscribe returned no subscription id" } : failed;
      } catch (err) {
        return { state: err.state ?? "error", message: err.message };
      }
    });
  } finally {
    session.close();
  }
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
  // Nothing was tested, so it must not count as a strike.
  if (result.verdict === "no_signature") return { ...result, endpoint };
  await recordRpcResult(kind, endpoint.url, result.ok, { error: result.ok ? null : result.message, stamp: true });
  const set = { lastTest: { at: new Date(), verdict: result.verdict, latencyMs: result.latencyMs, message: result.message } };
  if (result.ok && enableOnSuccess && !endpoint.enabled) set.enabled = true;
  const updated = await Model.findByIdAndUpdate(id, { $set: set }, { returnDocument: "after" });
  return { ...result, endpoint: updated };
}
