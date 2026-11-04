import http from "http";
import crypto from "crypto";
import { Wallet } from "../models/Wallet.js";
import { WalletTrader } from "../models/WalletTrader.js";
import { Trader } from "../models/Trader.js";
import { logEvent } from "../systemLog.js";
import { normalizeUserTrade } from "../backtest/pumpTradesClient.js";
import { handleDetectedTrade, FRESH_BUY_SECONDS } from "../simulation/detectedTrade.js";
import { grpcTrackerConfigured, syncTrackedWallets } from "./client.js";

/**
 * The "grpc" tracking method (Wallet.settings.trackingMethod), the tracker daemon's half:
 *
 *  - SYNC: every few seconds the traders of every wallet set to "grpc" (active ones) are handed to the standalone gRPC tracking server, which follows
 *    their wallets over Yellowstone gRPC. Only these are tracked there - not the traders of the logs / API wallets or the simulation profiles.
 *  - WEBHOOK: the server POSTs each trade of a tracked wallet here the moment it is decoded ({ trades: [user-trades rows] }, "Authorization: Bearer
 *    GRPC_TRACKER_KEY"). Each is treated exactly like a trade the user-trades API reported to the "api" poller: recorded in the API ledger and evaluated by
 *    the wallets that follow the trader by "grpc" (buys older than FRESH_BUY_SECONDS are skipped, late sells are still acted on).
 *
 *   GRPC_TRACKER_URL / GRPC_TRACKER_KEY   the server (see db/grpc/client.js)
 *   GRPC_WEBHOOK_PORT (default 4002) / GRPC_WEBHOOK_HOST (default 127.0.0.1)   where this daemon listens; put the same URL in the server's WEBHOOK_URL
 */

const SYNC_INTERVAL_MS = 10_000;
const MAX_BODY = 4 * 1024 * 1024;
export const WEBHOOK_PATH = "/grpc/trades";

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();

export class GrpcFeed {
  /** @param {{ onError?: (err: Error) => void }} [options] */
  constructor({ onError = () => {} } = {}) {
    this.onError = onError;
    this.server = null;
    this.syncTimer = null;
    this.syncing = false;
    this.lastSyncErrorAt = 0;
    this.stats = { webhookRequests: 0, trades: 0, staleBuys: 0, rejected: 0, lastTradeAt: null };
  }

  start() {
    if (!grpcTrackerConfigured()) return; // not set up: the "grpc" method simply has no feed
    const key = process.env.GRPC_TRACKER_KEY;
    if (!key) {
      logEvent("tracker", "gRPC tracking: GRPC_TRACKER_KEY is not set - the webhook is not started", { level: "error" });
      return;
    }
    const keyDigest = digest(key);
    const port = Number(process.env.GRPC_WEBHOOK_PORT) || 4002;
    const host = process.env.GRPC_WEBHOOK_HOST || "127.0.0.1";

    this.server = http.createServer((req, res) => {
      this.#handle(req, res, keyDigest).catch((err) => {
        this.onError(err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    this.server.on("error", (err) => {
      this.onError(err);
      logEvent("tracker", `gRPC webhook could not listen on ${host}:${port}: ${err.message}`, { level: "error" });
    });
    this.server.listen(port, host, () => logEvent("tracker", `gRPC webhook listening on http://${host}:${port}${WEBHOOK_PATH}`));

    this.sync().catch(this.onError);
    this.syncTimer = setInterval(() => this.sync().catch(this.onError), SYNC_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.syncTimer);
    this.syncTimer = null;
    this.server?.close();
    this.server = null;
  }

  /** Makes the server track exactly the active traders of the "grpc" wallets. */
  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const wallets = await Wallet.find({ "settings.trackingMethod": "grpc" }, { _id: 1 }).lean();
      const addresses = wallets.length ? await WalletTrader.distinct("traderAddress", { walletId: { $in: wallets.map((w) => w._id) } }) : [];
      const active = addresses.length ? await Trader.find({ address: { $in: addresses }, status: "active" }, { address: 1 }).lean() : [];
      try {
        await syncTrackedWallets(active.map((t) => t.address));
      } catch (err) {
        // one line a minute at most: an outage would otherwise write one per sync
        if (Date.now() - this.lastSyncErrorAt > 60_000) {
          this.lastSyncErrorAt = Date.now();
          logEvent("tracker", `gRPC tracking server not reachable: ${err.message}`, { level: "warn" });
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  async #handle(req, res, keyDigest) {
    const reply = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
      res.end(text);
    };
    if (req.method !== "POST" || req.url !== WEBHOOK_PATH) return reply(404, { error: "not found" });
    const header = req.headers.authorization || "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!crypto.timingSafeEqual(digest(given), keyDigest)) {
      this.stats.rejected += 1;
      return reply(401, { error: "unauthorised" });
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return reply(413, { error: "body too large" });
      chunks.push(chunk);
    }
    let rows;
    try {
      rows = JSON.parse(Buffer.concat(chunks).toString("utf8")).trades;
    } catch {
      return reply(400, { error: "body is not valid JSON" });
    }
    if (!Array.isArray(rows)) return reply(400, { error: "trades must be an array" });

    this.stats.webhookRequests += 1;
    // In order, one after the other: a buy and the sell after it must reach the wallets in the order they happened.
    for (const row of rows) {
      if (typeof row?.walletAddress !== "string" || typeof row?.mint !== "string" || typeof row?.tx !== "string") continue;
      const t = normalizeUserTrade(row);
      if (!Number.isFinite(t.ts)) continue;
      t.feed = { quoteMint: row.quoteMint ?? null, hops: row.hops ?? 1, venue: row.venue ?? null };
      if (t.isBuy && Date.now() / 1000 - t.ts > FRESH_BUY_SECONDS) {
        this.stats.staleBuys += 1;
        continue;
      }
      this.stats.trades += 1;
      this.stats.lastTradeAt = Date.now();
      await handleDetectedTrade(row.walletAddress, t, { trackingMethod: "grpc", onError: this.onError, rethrow: true });
    }
    reply(200, { ok: true, handled: rows.length });
  }
}
