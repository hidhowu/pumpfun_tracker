import { EventEmitter } from "events";

const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15000;
const WATCHDOG_INTERVAL_MS = 20000;
// If a connection attempt has neither succeeded nor failed-and-scheduled-a-
// retry within this long, something got stuck outside the normal
// open/close/error lifecycle - see the watchdog comment below for why this
// is needed in practice, not just in theory.
const WATCHDOG_STALL_THRESHOLD_MS = 20000;
// How long to wait after an "error" event for "close" to follow before
// treating it as disconnected anyway - see the error handler below.
const ERROR_WITHOUT_CLOSE_GRACE_MS = 2000;
// Gap between each logsSubscribe call when resubscribing a batch of
// addresses after a reconnect - firing them all at once (the original bug)
// is exactly what trips a provider's requests-per-second limit right when
// the connection has just come back, matching the stagger already used for
// the same reason in TrackerService's rebalance-apply loop.
const RESUBSCRIBE_STAGGER_MS = 500;
// A request that gets no answer (or waits on a connection that never comes
// back) must fail rather than hang forever and block callers like the sync loop.
const REQUEST_TIMEOUT_MS = 20000;
// Public/shared RPC nodes close WebSocket connections that go quiet, and
// the browser-style WebSocket API has no ping frame - so send a tiny
// JSON-RPC request on a timer purely to generate traffic in both
// directions (the reply, even an error, counts). If nothing at all has
// arrived for HEARTBEAT_DEAD_AFTER_MS the socket is half-open/dead and gets
// replaced instead of waiting for a close event that may never come.
const HEARTBEAT_INTERVAL_MS = 20000;
const HEARTBEAT_DEAD_AFTER_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    this.reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    this.closedByUser = false;
    this._reconnectTimer = null; // set while a retry is scheduled and waiting
    this._connectingSince = Date.now(); // when the current socket attempt started
    // Last-resort safety net: on its own interval, checks whether the
    // connection has been down with NOTHING scheduled to fix it, and forces
    // a fresh attempt if so. This exists because in production this
    // subscriber has been observed to go silently, permanently dead after
    // an "error" event that was never followed by the "close" event its own
    // reconnect logic depends on (the WebSocket spec says close always
    // follows error, but that guarantee didn't hold here) - without this,
    // the only way out was a manual restart of the whole daemon.
    this._watchdogTimer = setInterval(() => this._watchdogCheck(), WATCHDOG_INTERVAL_MS);
    this._lastMessageAt = Date.now(); // last time ANY data arrived on the current socket
    this._heartbeatTimer = setInterval(() => this._heartbeat(), HEARTBEAT_INTERVAL_MS);
    this._connect();
  }

  _connect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._connectingSince = Date.now();
    const url = this.wsUrls[this.urlIndex % this.wsUrls.length];
    const socket = new WebSocket(url);
    this.ws = socket;
    let disconnectHandled = false; // true once this socket's disconnect has been handled - NOT set by "open", or a drop after a successful connect would be ignored
    const isCurrent = () => this.ws === socket; // ignore late events from a socket we've since moved on from (e.g. forceReconnect)

    socket.addEventListener("open", () => {
      if (!isCurrent()) return;
      this._lastMessageAt = Date.now();
      this.reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
      this.emit("connected", url);
      const previouslyWatched = [...this.subscriptions.keys()];
      this.subscriptions.clear();
      this.subIdToAddress.clear();
      if (previouslyWatched.length > 0) {
        this.emit("resubscribing", previouslyWatched.length);
        this._resubscribeStaggered(previouslyWatched, socket);
      }
    });
    socket.addEventListener("message", (event) => {
      if (!isCurrent()) return;
      this._lastMessageAt = Date.now();
      this._onMessage(event.data);
    });
    socket.addEventListener("close", () => {
      if (disconnectHandled || !isCurrent()) return;
      disconnectHandled = true;
      this._handleDisconnect(url);
    });
    socket.addEventListener("error", (err) => {
      if (!isCurrent()) return;
      this.emit("error", err.error || err);
      // Normally "close" follows "error" and _handleDisconnect runs from
      // there. If it doesn't show up within a couple seconds, don't wait
      // forever - treat this attempt as failed and reconnect anyway.
      setTimeout(() => {
        if (disconnectHandled || !isCurrent()) return;
        disconnectHandled = true;
        try {
          socket.close();
        } catch {
          // best-effort - already closing or closed
        }
        this._handleDisconnect(url);
      }, ERROR_WITHOUT_CLOSE_GRACE_MS);
    });
  }

  _handleDisconnect(url) {
    for (const { reject } of this.pending.values()) reject(new Error("WebSocket closed"));
    this.pending.clear();
    if (this.closedByUser) return;
    this.emit("disconnected", url);
    this.urlIndex += 1;
    this._reconnectTimer = setTimeout(() => this._connect(), this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  }

  /**
   * Re-subscribes a batch of addresses one at a time with a small gap
   * between each, instead of firing every logsSubscribe call in the same
   * instant a connection comes back - the latter is exactly what trips a
   * provider's requests-per-second limit right after a reconnect, which is
   * the worst possible time for it (you're already recovering from one
   * problem). Stops early if this socket stops being the current one
   * (superseded by a fresh reconnect) or disconnects again mid-batch -
   * whatever's left unsubscribed will naturally get picked up by the next
   * successful "open".
   */
  async _resubscribeStaggered(addresses, socket) {
    for (const address of addresses) {
      if (this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
      try {
        await this.watch(address);
      } catch (err) {
        this.emit("error", err);
      }
      await sleep(RESUBSCRIBE_STAGGER_MS);
    }
  }

  /**
   * Runs on an independent timer, regardless of what the socket's own
   * event listeners think is happening. If we're not connected AND no
   * retry is currently scheduled AND we've been sitting like that for
   * longer than the stall threshold, force a brand new attempt - this is
   * the fallback for exactly the "error fired, close never did, nothing
   * ever gets scheduled" failure mode this was added for.
   */
  _watchdogCheck() {
    if (this.closedByUser) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this._reconnectTimer) return; // a retry is already scheduled - normal backoff is handling it
    if (Date.now() - this._connectingSince < WATCHDOG_STALL_THRESHOLD_MS) return; // still within a normal connection attempt's budget
    this.emit("error", new Error("Watchdog: connection stalled with no reconnect scheduled - forcing a fresh attempt"));
    this._connect();
  }

  /**
   * Keepalive + dead-socket detection, see HEARTBEAT_* above. The request
   * id isn't registered in `pending`, so _onMessage simply ignores the reply.
   */
  _heartbeat() {
    if (this.closedByUser) return;
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const silentMs = Date.now() - this._lastMessageAt;
    if (silentMs > HEARTBEAT_DEAD_AFTER_MS) {
      this.emit("error", new Error(`Heartbeat: no data for ${Math.round(silentMs / 1000)}s - replacing the connection`));
      this.forceReconnect();
      return;
    }
    try {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: this.nextRequestId++, method: "logsUnsubscribe", params: [0] }));
    } catch {
      // a failed send means the socket is already going down - its close/error handlers take it from here
    }
  }

  _ensureOpen() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve) => this.once("connected", resolve));
  }

  async _send(method, params) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${method} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)), REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this._sendOnce(method, params), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async _sendOnce(method, params) {
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

  /**
   * Synchronously stops tracking an address locally, WITHOUT sending
   * logsUnsubscribe - for when there's no live connection to send it over
   * in the first place (e.g. an address was reassigned away from this
   * endpoint while it's disconnected). Calling unwatch() here would just
   * queue behind _ensureOpen() until this socket happens to reconnect,
   * which is both pointless (the subscription already died with the old
   * socket server-side) and actively harmful: if left in `subscriptions`,
   * this address would be included in the next reconnect's resubscribe
   * batch and end up double-subscribed - once here, once on wherever it
   * was actually reassigned to.
   */
  forget(address) {
    const subId = this.subscriptions.get(address);
    if (subId === undefined) return;
    this.subscriptions.delete(address);
    this.subIdToAddress.delete(subId);
  }

  watchedAddresses() {
    return [...this.subscriptions.keys()];
  }

  close() {
    this.closedByUser = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this.ws?.close();
  }

  /**
   * Forces a brand new connection attempt right now, regardless of the
   * current socket's state. Used for a manual "reconnect" action triggered
   * from the UI. Deliberately does NOT just close the socket and wait for
   * the normal close-driven reconnect to pick it up: if the socket is
   * already fully closed - the common case someone reaches for this button,
   * since the automatic retry loop has stalled - close() on it is a no-op
   * and nothing would happen, which is exactly the bug this replaces.
   */
  forceReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    try {
      this.ws?.close();
    } catch {
      // best-effort - the socket may already be in a state where close() throws or is a no-op
    }
    this._connect();
  }
}
