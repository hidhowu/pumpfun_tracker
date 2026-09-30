import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * An HTTP/SOCKS proxy the pump.fun API client (db/pumpFunApi.js) rotates
 * through, to spread requests across more than one origin IP and avoid
 * rate limits. Managed from the /proxies UI.
 *
 * `enabled` is the user's manual on/off switch; `status` is auto-managed
 * health, separate from it - a proxy transitions to "blacklisted" on its
 * own once db/proxyService.js sees consecutiveFailures reach the failure
 * threshold, and only comes back via a successful use OR an explicit
 * "Test" from the UI (which both re-checks and, on success, un-blacklists
 * it) - never automatically just because time passed, since nothing else
 * would have actually verified it started working again.
 */
const ProxySchema = new Schema({
  url: { type: String, required: true, unique: true }, // e.g. http://user:pass@host:port or socks5://host:port
  label: { type: String, default: "" },
  enabled: { type: Boolean, default: true },
  status: { type: String, enum: ["active", "blacklisted"], default: "active" },
  consecutiveFailures: { type: Number, default: 0 },
  lastCheckedAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

export const Proxy = models.Proxy || model("Proxy", ProxySchema);
