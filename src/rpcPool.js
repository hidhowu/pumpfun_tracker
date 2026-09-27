/**
 * Round-robins JSON-RPC HTTP calls randomly across multiple endpoints so no
 * single provider's requests-per-second limit gets hit as hard. Falls over
 * to another endpoint on rate-limit / transient errors.
 */
export class RpcPool {
  constructor(urls) {
    if (!urls || urls.length === 0) throw new Error("RpcPool requires at least one RPC URL");
    this.urls = urls;
  }

  pickUrl() {
    return this.urls[Math.floor(Math.random() * this.urls.length)];
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
          await sleep(150 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new Error(`${url} HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        if (json.error) {
          const rateLimited = json.error.code === 429 || /rate.?limit/i.test(json.error.message || "");
          if (rateLimited) {
            lastError = new Error(`${url} RPC error ${json.error.code}: ${json.error.message}`);
            await sleep(150 * (attempt + 1));
            continue;
          }
          throw new Error(`${url} RPC error ${json.error.code}: ${json.error.message}`);
        }
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
