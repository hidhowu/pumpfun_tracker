/**
 * Round-robins JSON-RPC HTTP calls across multiple endpoints so no single
 * provider's requests-per-second limit gets hit as hard. Falls over to
 * another endpoint on rate-limit / transient errors. `urls` can be swapped
 * out live (see src/tracker.js's startHttpRpcPoolSync) by reassigning
 * `.urls` directly - pickUrl() always reads the current array.
 *
 * `onResult(url, ok, error)` (optional) reports rate-limit strikes and the
 * recovery after one, so the caller can blacklist an endpoint that keeps
 * getting throttled. Successes are only reported while a strike is
 * outstanding, so a healthy endpoint costs no extra work per call.
 */
export class RpcPool {
  constructor(urls, { onResult } = {}) {
    if (!urls || urls.length === 0) throw new Error("RpcPool requires at least one RPC URL");
    this.urls = urls;
    this._index = 0;
    this._onResult = onResult;
    this._struckUrls = new Set(); // endpoints with an unanswered rate-limit strike
  }

  _reportStrike(url, error) {
    if (!this._onResult) return;
    this._struckUrls.add(url);
    this._onResult(url, false, error);
  }

  _reportSuccess(url) {
    if (!this._onResult || !this._struckUrls.delete(url)) return;
    this._onResult(url, true, null);
  }

  pickUrl() {
    const url = this.urls[this._index % this.urls.length];
    this._index += 1;
    return url;
  }

  async call(method, params, { maxAttempts } = {}) {
    const attempts = maxAttempts ?? Math.max(3, this.urls.length * 2);
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const url = this.pickUrl();
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (res.status === 429 || res.status === 503) {
          lastError = new Error(`${url} rate-limited (HTTP ${res.status})`);
          if (res.status === 429) this._reportStrike(url, "HTTP 429 rate limited");
          await sleep(150 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new Error(`${url} HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        if (json.error) {
          const rateLimited = json.error.code === 429 || /rate.?limit/i.test(json.error.message || "");
          if (rateLimited) {
            lastError = new Error(`${url} RPC error ${json.error.code}: ${json.error.message}`);
            this._reportStrike(url, `Rate limited: ${json.error.message}`);
            await sleep(150 * (attempt + 1));
            continue;
          }
          throw new Error(`${url} RPC error ${json.error.code}: ${json.error.message}`);
        }
        this._reportSuccess(url);
        return json.result;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("RPC call failed with no further detail");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
