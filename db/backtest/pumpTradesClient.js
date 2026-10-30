import { execCurl } from "../curlBinary.js";
import { getActiveProxyPool, recordProxyResult, redactCredentials, PROXY_BROKEN_HTTP_STATUSES, randomPumpUserAgent } from "../proxyService.js";
import { resolveBacktestSettings } from "./settings.js";
import { SlotPool, Semaphore, sleep } from "./slotPool.js";

const FRONTEND_BASE = () => process.env.PUMP_FRONTEND_API_BASE || "https://frontend-api-v3.pump.fun";
// CAIP-2 id of Solana mainnet, as the /trades/<chain>/<mint> path wants it (colon percent-encoded).
const SOLANA_CHAIN_ID = "solana%3A5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const MARKER = "\n__PUMPCLIENT__";
const REFRESH_MS = 15_000;
const MAX_ATTEMPTS = 10;
const PAGE_LIMIT = 100; // the API's maximum
// A page of a token's trades is asked for with `before=<ordinalKey>` (blockId-txIndex-eventIndex-blockTimeMs): trades strictly older than it, newest
// first, time first - so MAX_KEY plus a time T means "everything up to and including second T". The next page starts from the oldest row's key.
const MAX_KEY = "999999999999-999999-999999"; // above any real block/tx/event index, so only the time part decides (a 20-digit block id is rejected: overflow)
const WSOL = "So11111111111111111111111111111111111111112";
// The server-side USD floor is kept this far under the exact SOL floor (applied to each row below), so a SOL price that moved since the
// last page never hides a trade that is above the floor.
const MIN_USD_SAFETY = 0.9;
const DIRECT_ID = "direct";
// The user-trades endpoint now and then answers 200 with an empty page in the middle of a history (same cursor handed back);
// asking again gets the real page, so an empty page with an unchanged cursor is retried this many times before giving up.
const EMPTY_PAGE_RETRIES = 10; // each retry goes out through the next proxy in the rotation
// Last resort (only when asked for, see fetchUserTrades `nudge`): rebuild the cursor a little further back in time and carry on from
// there instead of giving up: first the same instant with a neutral id (loses nothing), then 1s, 5s, 30s, 2min older (can skip
// the trades inside that gap, which is better than stopping the whole address).
const CURSOR_NUDGES_SEC = [0, 1, 5, 30, 120];
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const USER_TRADES_PAGE = 100;

/** The user-trades endpoint kept answering with an empty page for a cursor that has more history behind it. */
export class EmptyPageError extends Error {
  constructor(message = "pump.fun keeps returning an empty page for this wallet's trades") {
    super(message);
    this.name = "EmptyPageError";
  }
}

const pad = (n, width) => String(n).padStart(width, "0");

/**
 * Normalises one row of /trades/<chain>/<mint>: numbers instead of decimal strings, seconds instead of ms.
 * `valueNative` is the trade's worth in SOL whatever the pool is quoted in, so valueUsd / valueNative is the SOL price even for a
 * pool quoted in another token (where priceQuote is not a SOL price); priceSol is derived from it.
 */
function normalizeTrade(t) {
  const [block, txIndex, eventIndex] = t.ordinalKey.split("-");
  const tokens = Number(t.baseAmount.raw) / 10 ** t.baseAmount.decimals;
  const amountUsd = Number(t.valueUsd);
  const amountSol = Number(t.valueNative);
  const usdPerSol = amountSol > 0 ? amountUsd / amountSol : t.quote?.id === WSOL ? Number(t.quotePriceUsd) : NaN;
  const priceUsd = Number(t.priceUsd);
  return {
    // zero-padded so that comparing ids as strings (see byTime) orders them like the numbers they are
    id: `${pad(block, 12)}-${pad(txIndex, 6)}-${pad(eventIndex, 6)}`,
    key: t.ordinalKey,
    sig: t.txId,
    ts: Math.floor(t.blockTimeMs / 1000),
    user: t.trader?.address,
    type: t.side,
    program: t.venue,
    // Pool price immediately BEFORE this trade - i.e. the pool state at that moment.
    priceUsd,
    priceSol: priceUsd / usdPerSol,
    // This trade's own average execution price.
    fillPriceUsd: tokens > 0 ? amountUsd / tokens : NaN,
    amountSol,
    amountUsd,
    baseAmount: tokens,
  };
}

/** One user-trades row (a wallet's own swap), with numbers and seconds instead of strings. */
function normalizeUserTrade(t) {
  return {
    tx: t.tx,
    isBuy: !!t.isBuy,
    ts: Math.floor(Date.parse(t.timestamp) / 1000),
    mint: t.mint,
    amountSol: t.amountSol == null ? null : Number(t.amountSol),
    amountUsd: t.amountUsd == null ? null : Number(t.amountUsd),
    tokenAmount: t.baseAmount == null ? null : Number(t.baseAmount),
    slotIndexId: t.slotIndexId ?? null,
    kind: t.kind,
  };
}

const byTime = (a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Reads a token's trade history from pump.fun's swap API through the proxy
 * pool, round-robin, one rate-limited slot per proxy (see SlotPool). A 429
 * cools only the proxy that got it, for the time the server asked; the call
 * moves to another proxy. While proxies exist, requests never fall back to a
 * direct connection - that would burn this machine's own IP. With no proxies
 * configured at all it goes direct at the (low) configured direct rate.
 */
export class PumpTradesClient {
  /** @param {{rpsSetting?: "proxyRps"|"userTradesRps"}} [opts] which configured rate each proxy is paced at */
  constructor({ rpsSetting = "proxyRps" } = {}) {
    this.rpsSetting = rpsSetting;
    this.slots = new SlotPool();
    this.gate = new Semaphore(1); // requests in flight at once = one per proxy, set on refresh
    this.refreshedAt = 0;
    this.refreshing = null;
    this.settings = null;
    this.okRecordedAt = new Map(); // proxy id -> last time a success was written to Mongo (writes throttled)
    this.stats = { requests: 0, rateLimited: 0, failures: 0, emptyPages: 0, cursorNudges: 0 };
  }

  async refresh(force = false) {
    if (!force && Date.now() - this.refreshedAt < REFRESH_MS) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const [{ effective }, proxies] = await Promise.all([resolveBacktestSettings(), getActiveProxyPool().catch(() => [])]);
      this.settings = effective;
      this.slots.sync(
        proxies.length > 0
          ? proxies.map((p) => ({ id: String(p._id), rps: effective[this.rpsSetting] ?? effective.proxyRps, data: { proxy: p } }))
          : [{ id: DIRECT_ID, rps: effective.directRps, data: { proxy: null } }]
      );
      this.gate.setLimit(this.slots.size);
      this.refreshedAt = Date.now();
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** How many requests can usefully run at once: one per proxy (1 when going direct). Valid after refresh(). */
  get lanes() {
    return Math.max(1, this.slots.size);
  }

  async #curl(url, proxyUrl) {
    const args = ["-s", "-m", "20", "--compressed", "-H", "accept: application/json", "-w", `${MARKER}%{http_code}|%header{retry-after}`];
    if (proxyUrl) args.push("--proxy", proxyUrl);
    args.push(url);
    const { stdout } = await execCurl(args, { fallbackUserAgent: randomPumpUserAgent(), maxBuffer: 16 * 1024 * 1024 });
    const at = stdout.lastIndexOf(MARKER);
    const body = at >= 0 ? stdout.slice(0, at) : stdout;
    const [status, retryAfter] = at >= 0 ? stdout.slice(at + MARKER.length).split("|") : ["0", ""];
    return { status: Number(status) || 0, retryAfter: Number(retryAfter) || 0, body };
  }

  /**
   * GET `url` through the proxy pool, round-robin: a refused or unreachable proxy rests
   * and the request moves to the next one. Returns { status, body } for a 200 or a 404;
   * throws once every try is used up.
   */
  async #send(url) {
    await this.refresh();
    const tried = new Set();
    let lastError;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this.gate.acquire();
      try {
        const reservation = this.slots.reserve({ exclude: tried.size < this.slots.size ? tried : undefined });
        if (!reservation) throw new Error("No proxies or direct slot available");
        const { member, waitMs } = reservation;
        if (waitMs > 0) await sleep(waitMs);
        const proxy = member.data.proxy;
        this.stats.requests += 1;

        try {
          const { status, retryAfter, body } = await this.#curl(url, proxy?.url ?? null);
          if (status === 429) {
            this.stats.rateLimited += 1;
            this.slots.cool(member.id, Math.min(120, Math.max(5, retryAfter || 15)) * 1000);
            tried.add(member.id);
            lastError = new Error("pump.fun rate limit (429)");
            continue;
          }
          if (status === 403) {
            // Forbidden: this proxy sits out a few seconds, the request goes to the next proxy.
            this.stats.rateLimited += 1;
            if (proxy) recordProxyResult(proxy._id, false, "HTTP 403 through proxy").catch(() => {});
            this.slots.cool(member.id, 5000);
            tried.add(member.id);
            lastError = new Error(`pump.fun refused the request (HTTP 403) ${attempt + 1} times in a row, across the proxies tried`);
            continue;
          }
          if (!status || (proxy && PROXY_BROKEN_HTTP_STATUSES.has(status))) {
            if (proxy) recordProxyResult(proxy._id, false, `HTTP ${status || "no response"} through proxy`).catch(() => {});
            this.slots.cool(member.id, 20_000);
            tried.add(member.id);
            lastError = new Error(`no usable response${proxy ? " through proxy" : ""} (HTTP ${status || "none"})`);
            continue;
          }
          if (proxy) this.#recordOk(proxy._id);
          if (status === 404) return { status, body: "" };
          if (status >= 500) {
            lastError = new Error(`pump.fun HTTP ${status}`);
            await sleep(500 * (attempt + 1));
            continue;
          }
          if (status !== 200) throw new Error(`pump.fun HTTP ${status}`);
          return { status, body };
        } catch (err) {
          this.stats.failures += 1;
          lastError = new Error(redactCredentials(err.message));
          tried.add(member.id);
          if (proxy) recordProxyResult(proxy._id, false, err.message).catch(() => {});
          await sleep(300 * (attempt + 1));
        }
      } finally {
        this.gate.release();
      }
    }
    throw lastError || new Error("pump.fun request failed");
  }

  /**
   * One page of history: trades strictly before `before` (an ordinalKey), newest first. `nextCursor` is the key to pass as `before` for the next page
   * (the oldest row the API returned); `hasMore` is true while pages come back full - the API says nothing about the end of the history itself.
   * The dust floor (settings.minSolAmount, in SOL) is applied here exactly; the server is also asked for a slightly lower USD floor so most dust never
   * travels, once a SOL price is known from an earlier page.
   */
  async fetchPage(mint, before) {
    await this.refresh();
    const s = this.settings;
    const qs = new URLSearchParams({ limit: String(PAGE_LIMIT), before });
    if (s.program === "pump") qs.set("venue", "pump"); // the API knows only "pump" and "all" (omitted)
    if (s.minSolAmount > 0 && this.usdPerSol > 0) qs.set("minUsd", String(s.minSolAmount * this.usdPerSol * MIN_USD_SAFETY));
    const { status, body } = await this.#send(`${FRONTEND_BASE()}/trades/${SOLANA_CHAIN_ID}/${mint}?${qs}`);
    if (status === 404) return { trades: [], nextCursor: null, hasMore: false };
    const rows = JSON.parse(body).trades || [];
    const all = rows.map(normalizeTrade);
    const known = all.find((t) => t.priceSol > 0);
    if (known) this.usdPerSol = known.priceUsd / known.priceSol;
    const trades = s.minSolAmount > 0 ? all.filter((t) => t.amountSol >= s.minSolAmount) : all;
    return { trades, nextCursor: all.at(-1)?.key ?? null, hasMore: rows.length >= PAGE_LIMIT };
  }

  /**
   * The newest trades of a token, newest first - no cursor, no range. `minUsd` filters out smaller trades the way the API's own query
   * parameter does. An unknown token answers 404, which is an empty list here. Rows are in the new /trades/<chain>/<mint> shape
   * (txId, side, valueUsd, ...), not the one normalizeTrade reads.
   * @returns {Promise<object[]>}
   */
  async fetchRecentTokenTrades(mint, { limit = 1, minUsd = 0 } = {}) {
    await this.refresh();
    const qs = new URLSearchParams({ limit: String(limit) });
    if (minUsd > 0) qs.set("minUsd", String(minUsd));
    const { status, body } = await this.#send(`${FRONTEND_BASE()}/trades/${SOLANA_CHAIN_ID}/${mint}?${qs}`);
    if (status === 404) return [];
    return JSON.parse(body).trades || [];
  }

  /**
   * One page of a wallet's own swaps from pump.fun's user-trades API, newest first.
   * `cursor` is "<unix microseconds>:<uuid>" - the page holds trades strictly older
   * than it (omit for the newest). Returns the cursor for the next page, or null at the
   * end of the history. Only real swaps are requested (types=trades), not token transfers.
   * `limit` is how many trades one page holds (the API allows up to 100; a live poll only needs the newest few).
   * @returns {Promise<{trades: object[], nextCursor: string|null}>}
   */
  async fetchUserTrades(userId, cursor, { nudge = false, limit = USER_TRADES_PAGE } = {}) {
    await this.refresh();
    const urlFor = (c) => {
      const qs = new URLSearchParams({ types: "trades", limit: String(limit) });
      if (c) qs.set("cursor", c);
      return `${FRONTEND_BASE()}/user-trades/${encodeURIComponent(userId)}?${qs}`;
    };
    const micros = Number(String(cursor || "").split(":")[0]);

    // Asks for `asked`; null means "the glitch": an empty page that hands back the very cursor it was asked for (not the end of the history).
    const tryCursor = async (asked) => {
      for (let attempt = 0; attempt < EMPTY_PAGE_RETRIES; attempt++) {
        const { status, body } = await this.#send(urlFor(asked));
        if (status === 404) return { trades: [], nextCursor: null };
        const json = JSON.parse(body);
        const trades = (json.trades || []).map(normalizeUserTrade);
        const next = json.nextCursor || null;
        if (trades.length === 0 && next && next === asked) {
          this.stats.emptyPages += 1;
          await sleep(300 * (attempt + 1));
          continue;
        }
        return { trades, nextCursor: next };
      }
      return null;
    };

    const direct = await tryCursor(cursor);
    if (direct) return direct;
    if (!nudge || !(micros > 0)) throw new EmptyPageError();

    for (const back of CURSOR_NUDGES_SEC) {
      const nudged = `${Math.max(0, micros - back * 1_000_000)}:${ZERO_UUID}`;
      const page = await tryCursor(nudged);
      if (page) {
        this.stats.cursorNudges += 1;
        return page;
      }
    }
    throw new EmptyPageError();
  }

  #recordOk(proxyId) {
    const key = String(proxyId);
    if (Date.now() - (this.okRecordedAt.get(key) || 0) < 30_000) return;
    this.okRecordedAt.set(key, Date.now());
    recordProxyResult(proxyId, true).catch(() => {});
  }

  /**
   * Every trade with `fromSec <= timestamp <= toSec`, oldest first, read
   * completely: pages backward from `toSec` until a page reaches before
   * `fromSec` (or history runs out), so nothing inside the window is missing
   * even when the token trades thousands of times a minute.
   *
   * `prior` is the newest trade strictly before `fromSec` if the last page
   * happened to include one (null otherwise) - the fallback price source when
   * nothing traded inside the window.
   *
   * @returns {Promise<{trades: object[], prior: object|null, pages: number, exhausted: boolean, truncated: boolean}>}
   */
  async fetchRange(mint, fromSec, toSec, { maxPages = 400 } = {}) {
    let cursor = `${MAX_KEY}-${toSec * 1000}`;
    const seen = new Set();
    const inside = [];
    let prior = null;
    let pages = 0;
    let exhausted = false;
    let truncated = false;

    for (;;) {
      if (pages >= maxPages) {
        truncated = true;
        break;
      }
      const page = await this.fetchPage(mint, cursor);
      pages += 1;
      let reachedBefore = false;
      for (const t of page.trades) {
        if (t.ts < fromSec) {
          reachedBefore = true;
          if (!prior || byTime(t, prior) > 0) prior = t;
          continue;
        }
        if (t.ts > toSec || seen.has(t.id)) continue;
        seen.add(t.id);
        inside.push(t);
      }
      if (reachedBefore) break;
      // (a page can come back empty after the dust filter and still have history behind it - only a short page or no cursor ends it)
      if (!page.hasMore || !page.nextCursor) {
        exhausted = true;
        break;
      }
      cursor = page.nextCursor;
    }

    inside.sort(byTime);
    return { trades: inside, prior, pages, exhausted, truncated };
  }
}
