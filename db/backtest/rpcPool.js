import { SlotPool, sleep } from "./slotPool.js";
import { loadRpcPoolDefinition, resolveBacktestSettings } from "./settings.js";

const REFRESH_MS = 15_000;
const REQUEST_TIMEOUT_MS = 25_000;

/**
 * HTTP JSON-RPC pool for backtests. Same `call(method, params)` surface as
 * src/rpcPool.js (so parseTransaction works with it unchanged) but with
 * per-endpoint rate limits:
 *
 *  - "backtest only" endpoints run at the configured rate;
 *  - endpoints shared with live tracking run at `sharedRpcFraction` of it, so
 *    a big backtest can never starve live trade detection.
 *
 * Requests go round-robin to whichever endpoint has the earliest free slot
 * (see SlotPool); a 429 cools just that endpoint and the call moves on to
 * another one.
 */
export class BacktestRpcPool {
  constructor() {
    this.slots = new SlotPool();
    this.failures = new Map(); // endpoint -> consecutive rate-limit hits
    this.refreshedAt = 0;
    this.refreshing = null;
  }

  async refresh(force = false) {
    if (!force && Date.now() - this.refreshedAt < REFRESH_MS) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const [{ dedicated, shared }, { effective }] = await Promise.all([loadRpcPoolDefinition(), resolveBacktestSettings()]);
      this.slots.sync([
        ...dedicated.map((url) => ({ id: url, rps: effective.rpcRpsPerEndpoint, data: { url, shared: false } })),
        ...shared.map((url) => ({ id: url, rps: effective.rpcRpsPerEndpoint * effective.sharedRpcFraction, data: { url, shared: true } })),
      ]);
      this.refreshedAt = Date.now();
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async call(method, params, { maxAttempts } = {}) {
    await this.refresh();
    if (this.slots.size === 0) throw new Error("No RPC endpoints available for backtests");
    const attempts = maxAttempts ?? Math.max(4, this.slots.size * 2);
    const tried = new Set();
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt++) {
      // After every endpoint has failed once in this call, allow reuse rather than giving up early.
      const reservation = this.slots.reserve({ exclude: tried.size < this.slots.size ? tried : undefined });
      if (!reservation) break;
      const { member, waitMs } = reservation;
      if (waitMs > 0) await sleep(waitMs);
      const url = member.data.url;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.status === 429 || res.status === 503) {
          this.#rateLimited(member.id, res.headers.get("retry-after"));
          lastError = new Error(`${redact(url)} rate-limited (HTTP ${res.status})`);
          tried.add(member.id);
          continue;
        }
        if (!res.ok) throw new Error(`${redact(url)} HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) {
          if (json.error.code === 429 || /rate.?limit|too many/i.test(json.error.message || "")) {
            this.#rateLimited(member.id, null);
            lastError = new Error(`${redact(url)} rate-limited: ${json.error.message}`);
            tried.add(member.id);
            continue;
          }
          // e.g. "slot skipped / not available" on a node without full history - another endpoint may have it.
          lastError = new Error(`${redact(url)} RPC error ${json.error.code}: ${json.error.message}`);
          tried.add(member.id);
          continue;
        }
        this.failures.delete(member.id);
        return json.result;
      } catch (err) {
        lastError = err;
        tried.add(member.id);
      }
    }
    throw lastError || new Error("RPC call failed with no further detail");
  }

  #rateLimited(id, retryAfterHeader) {
    const n = (this.failures.get(id) || 0) + 1;
    this.failures.set(id, n);
    const asked = Number(retryAfterHeader);
    const coolMs = Number.isFinite(asked) && asked > 0 ? asked * 1000 : Math.min(30_000, 1000 * 2 ** Math.min(n, 5));
    this.slots.cool(id, coolMs);
  }
}

/** Provider URLs usually embed an API key - never put one in an error message. */
function redact(url) {
  try {
    return new URL(url).host;
  } catch {
    return "rpc";
  }
}
