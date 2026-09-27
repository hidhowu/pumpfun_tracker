import { EventEmitter } from "events";

/**
 * Maintains one WebSocket connection and, over it, one Solana `logsSubscribe`
 * subscription per watched address. Emits a "signature" event as soon as any
 * watched address appears in a transaction's logs — using `commitment`
 * "processed" (default) is what makes this the fastest possible path; never
 * use "finalized" here, it lags well behind the tip of the chain.
 *
 * Addresses can be added/removed at any time via watch()/unwatch(), including
 * while already connected and running.
 *
 * Events emitted: "connected", "disconnected", "watching", "unwatched",
 * "signature" ({ address, signature, err, logs, slot }), "error".
 */
export class LogSubscriber extends EventEmitter {
  constructor(wsUrls, { commitment = "processed" } = {}) {
    super();
    if (!wsUrls || wsUrls.length === 0) throw new Error("LogSubscriber requires at least one WebSocket URL");
    this.wsUrls = wsUrls;
    this.commitment = commitment;
    this.urlIndex = 0;
    this.ws = null;
    this.nextRequestId = 1;
    this.pending = new Map(); // requestId -> { resolve, reject }
    this.subscriptions = new Map(); // address -> subscriptionId
    this.subIdToAddress = new Map(); // subscriptionId -> address
    this.reconnectDelayMs = 1000;
    this.closedByUser = false;
    this._connect();
  }

  _connect() {
    const url = this.wsUrls[this.urlIndex % this.wsUrls.length];
    this.ws = new WebSocket(url);
    this.ws.addEventListener("open", () => {
      this.reconnectDelayMs = 1000;
      this.emit("connected", url);
      const previouslyWatched = [...this.subscriptions.keys()];
      this.subscriptions.clear();
      this.subIdToAddress.clear();
      if (previouslyWatched.length > 0) {
        this.emit("resubscribing", previouslyWatched.length);
        for (const address of previouslyWatched) this.watch(address).catch((err) => this.emit("error", err));
      }
    });
    this.ws.addEventListener("message", (event) => this._onMessage(event.data));
    this.ws.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("WebSocket closed"));
      this.pending.clear();
      if (this.closedByUser) return;
      this.emit("disconnected", url);
      this.urlIndex += 1;
      setTimeout(() => this._connect(), this.reconnectDelayMs);
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15000);
    });
    this.ws.addEventListener("error", (err) => this.emit("error", err.error || err));
  }

  _ensureOpen() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve) => this.once("connected", resolve));
  }

  async _send(method, params) {
    await this._ensureOpen();
    return new Promise((resolve, reject) => {
      const id = this.nextRequestId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.method === "logsNotification") {
      const subId = msg.params.subscription;
      const address = this.subIdToAddress.get(subId);
      const { signature, err, logs } = msg.params.result.value;
      this.emit("signature", { address, signature, err, logs, slot: msg.params.result.context.slot });
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  }

  /** Start watching an address's logs. Safe to call while already connected. */
  async watch(address) {
    if (this.subscriptions.has(address)) return this.subscriptions.get(address);
    let subId;
    try {
      subId = await this._send("logsSubscribe", [{ mentions: [address] }, { commitment: this.commitment }]);
    } catch (err) {
      throw new Error(`watch(${address}) failed: ${err.message}`);
    }
    this.subscriptions.set(address, subId);
    this.subIdToAddress.set(subId, address);
    this.emit("watching", address);
    return subId;
  }

  /** Stop watching an address. */
  async unwatch(address) {
    const subId = this.subscriptions.get(address);
    if (subId === undefined) return;
    await this._send("logsUnsubscribe", [subId]);
    this.subscriptions.delete(address);
    this.subIdToAddress.delete(subId);
    this.emit("unwatched", address);
  }

  watchedAddresses() {
    return [...this.subscriptions.keys()];
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
