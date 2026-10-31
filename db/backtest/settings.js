import { BacktestSettings } from "../models/BacktestSettings.js";
import { HttpRpcEndpoint } from "../models/HttpRpcEndpoint.js";
import { Proxy } from "../models/Proxy.js";

// Measured against pump.fun's trades API: about 1 request per second per IP is
// sustained without 429s; faster bursts get blocked with a growing penalty.
const DEFAULT_PROXY_RPS = 0.8;
// Typical paid-tier Solana RPC; the user lowers this per their provider if needed.
const DEFAULT_RPC_RPS = 8;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export async function getBacktestSettingsDoc() {
  let doc = await BacktestSettings.findOne({ key: "default" });
  if (!doc) {
    try {
      doc = await BacktestSettings.create({ key: "default" });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      doc = await BacktestSettings.findOne({ key: "default" });
    }
  }
  return doc;
}

/** Splits the RPC pool the way the backtest sees it: dedicated (backtest-only) vs shared with live. */
export async function loadRpcPoolDefinition() {
  const rows = await HttpRpcEndpoint.find({ enabled: true, health: { $ne: "blacklisted" } }, { url: 1, scope: 1 }).lean();
  const dedicated = rows.filter((r) => r.scope === "backtest").map((r) => r.url);
  const envUrls = (process.env.SOLANA_RPC_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const shared = [...new Set([...rows.filter((r) => r.scope !== "backtest").map((r) => r.url), ...envUrls])].filter(
    (u) => !dedicated.includes(u)
  );
  if (dedicated.length === 0 && shared.length === 0) shared.push("https://api.mainnet-beta.solana.com");
  return { dedicated, shared };
}

export async function countActiveProxies() {
  return Proxy.countDocuments({ enabled: true, status: "active" });
}

/**
 * Effective settings = whatever is set explicitly, otherwise a value derived
 * from the current number of proxies and RPC endpoints. Also returns the
 * capacity it derived them from, so the UI can explain "auto".
 */
export async function resolveBacktestSettings() {
  const [doc, rpc, proxyCount] = await Promise.all([getBacktestSettingsDoc(), loadRpcPoolDefinition(), countActiveProxies()]);
  const s = doc.toObject();

  const proxyRps = s.proxyRps ?? DEFAULT_PROXY_RPS;
  const rpcRps = s.rpcRpsPerEndpoint ?? DEFAULT_RPC_RPS;
  const sharedFraction = clamp(s.sharedRpcFraction ?? 0.3, 0.05, 1);

  const pumpCapacityRps = proxyCount > 0 ? proxyCount * proxyRps : s.directRps;
  const rpcCapacityRps = rpc.dedicated.length * rpcRps + rpc.shared.length * rpcRps * sharedFraction;

  // The slower of the two stages sets the pace; parallelism just has to keep both pipelines full.
  const addressParallelism = s.addressParallelism ?? clamp(Math.ceil(Math.max(pumpCapacityRps, rpcCapacityRps / 4)), 2, 40);
  const txParallelismPerAddress = s.txParallelismPerAddress ?? clamp(Math.ceil((rpcCapacityRps * 0.8) / addressParallelism), 2, 10);
  // Shared by every address: one trade per proxy keeps all proxies busy (the per-proxy pacing in SlotPool sets the actual rate).
  const positionParallelism = s.positionParallelism ?? clamp(proxyCount > 0 ? proxyCount : 2, 1, 100);

  return {
    stored: s,
    effective: {
      addressParallelism,
      txParallelismPerAddress,
      positionParallelism,
      rpcRpsPerEndpoint: rpcRps,
      sharedRpcFraction: sharedFraction,
      proxyRps,
      userTradesRps: s.userTradesRps ?? 4,
      fillLatencySeconds: s.fillLatencySeconds ?? 3,
      directRps: s.directRps,
      minSolAmount: s.minSolAmount,
      program: s.program ?? "",
      initialWindowSeconds: clamp(s.initialWindowSeconds || 60, 5, 3600),
      maxPagesPerPosition: Math.max(5, s.maxPagesPerPosition || 400),
    },
    worker: { heartbeatAt: s.workerHeartbeatAt ?? null, id: s.workerId ?? null },
    capacity: {
      proxies: proxyCount,
      rpcDedicated: rpc.dedicated.length,
      rpcShared: rpc.shared.length,
      pumpCapacityRps,
      rpcCapacityRps,
    },
  };
}

const NUMERIC_FIELDS = [
  "addressParallelism",
  "txParallelismPerAddress",
  "positionParallelism",
  "rpcRpsPerEndpoint",
  "sharedRpcFraction",
  "proxyRps",
  "userTradesRps",
  "fillLatencySeconds",
  "directRps",
  "minSolAmount",
  "initialWindowSeconds",
  "maxPagesPerPosition",
];

/** Applies a partial update; null on an "auto-able" field resets it to auto. Unknown/invalid values are ignored. */
export async function updateBacktestSettings(patch) {
  const doc = await getBacktestSettingsDoc();
  for (const field of NUMERIC_FIELDS) {
    if (!(field in patch)) continue;
    const v = patch[field];
    if (v === null) {
      if (["sharedRpcFraction", "userTradesRps", "fillLatencySeconds", "directRps", "minSolAmount", "initialWindowSeconds", "maxPagesPerPosition"].includes(field)) continue; // these always have a value
      doc[field] = null;
    } else if (typeof v === "number" && Number.isFinite(v) && (v > 0 || ((field === "minSolAmount" || field === "fillLatencySeconds") && v === 0))) {
      doc[field] = field.endsWith("Parallelism") || field === "maxPagesPerPosition" || field === "initialWindowSeconds" ? Math.round(v) : v;
    }
  }
  if (typeof patch.program === "string") doc.program = patch.program.trim();
  await doc.save();
  return resolveBacktestSettings();
}
