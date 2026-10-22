/**
 * One place that says what a trading setting may be. Every route and service that writes a setting (global defaults,
 * per-trader overrides, wallet settings, backtest settings, promote/import paths) validates through here, so a typo,
 * a bad client or a hostile request can never store a negative trade size, a fee above the cap, Infinity, or a value
 * that breaks a timer. Out-of-range values are REJECTED with a message, never silently clamped, so nobody believes a
 * number was saved that wasn't.
 */

/** Hard caps the owner chose: the most a single fill may pay. */
export const MAX_PUMP_FEE_PERCENT = 2;
export const MAX_JITO_FEE_USD = 1;

const DAY = 24 * 60 * 60;

// field -> [min, max, { minExclusive }]. Same names as the Wallet/Profile/Trader settings; the `default*` global
// names are mapped onto these by validateField().
const NUMBER_LIMITS = {
  allocationUsd: [0, 1_000_000_000],
  startingBalanceUsd: [0, 1_000_000_000],
  tradeSizeUsd: [0, 1_000_000, { minExclusive: true }],
  dustBuyUsd: [0, 1_000_000],
  dustSellFractionPercent: [0, 100],
  executionDelaySeconds: [0, 3600],
  maxTradeTimeSeconds: [0, 30 * DAY], // 0 = disabled
  pumpFeePercent: [0, MAX_PUMP_FEE_PERCENT],
  jitoFeeUsd: [0, MAX_JITO_FEE_USD],
  riskCheckIntervalSeconds: [5, 3600], // the ceiling keeps it far below Node's 2^31 ms timer limit
  apiPollsPerSecond: [0.2, 10], // per trader; the proxy pool's own pacing is the real ceiling, this only keeps a typo from asking for 1000
};

// Percent thresholds that must be a real positive number when set (null disables them): 0 would fire on the first sweep.
const NULLABLE_LIMITS = {
  stopLossPercent: [0, 100, { minExclusive: true }],
  takeProfitPercent: [0, 100_000, { minExclusive: true }],
  panicLossUsd: [0, 1_000_000_000, { minExclusive: true }], // a wallet's panic level in dollars; null = off
};

const FIELD_ALIASES = {
  defaultAllocationUsd: "allocationUsd",
  defaultTradeSizeUsd: "tradeSizeUsd",
  defaultDustBuyUsd: "dustBuyUsd",
  defaultDustSellFractionPercent: "dustSellFractionPercent",
  defaultExecutionDelaySeconds: "executionDelaySeconds",
  defaultMaxTradeTimeSeconds: "maxTradeTimeSeconds",
  defaultPumpFeePercent: "pumpFeePercent",
  defaultJitoFeeUsd: "jitoFeeUsd",
  defaultStopLossPercent: "stopLossPercent",
  defaultTakeProfitPercent: "takeProfitPercent",
};

/** Splits a limits entry into [min, max, minExclusive]. */
function bounds(entry) {
  return [entry[0], entry[1], !!entry[2]?.minExclusive];
}

function rangeText([min, max, minExclusive]) {
  return `${minExclusive ? "greater than" : "at least"} ${min} and at most ${max}`;
}

/**
 * Checks one numeric setting. Returns { ok: true, value } or { ok: false, error }.
 * `null` is valid only for the nullable (can-be-disabled) settings. Anything that isn't a finite JS number is rejected.
 * @param {string} field
 * @param {unknown} value
 * @returns {{ ok: boolean, value?: number | null, error?: string }}
 */
export function validateField(field, value) {
  const name = FIELD_ALIASES[field] || field;
  const nullable = NULLABLE_LIMITS[name];
  if (value === null) {
    return nullable ? { ok: true, value: null } : { ok: false, error: `${name} cannot be empty` };
  }
  const entry = nullable || NUMBER_LIMITS[name];
  if (!entry) return { ok: false, error: `Unknown setting ${name}` };
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: `${name} must be a finite number` };
  const [min, max, minExclusive] = bounds(entry);
  if (value > max || value < min || (minExclusive && value === min)) {
    return { ok: false, error: `${name} must be ${rangeText([min, max, minExclusive])}` };
  }
  return { ok: true, value };
}

/**
 * Trailing-stop rule list: each rule needs finite arm/exit percents in a sane range. Returns { ok, value } | { ok: false, error }.
 * @param {unknown} list
 * @returns {{ ok: boolean, value?: { armPercent: number, exitPercent: number, _id?: string }[], error?: string }}
 */
export function validateTrailingStops(list) {
  if (!Array.isArray(list)) return { ok: false, error: "trailingStops must be a list" };
  const out = [];
  for (const rule of list) {
    const arm = rule?.armPercent;
    const exit = rule?.exitPercent;
    if (typeof arm !== "number" || !Number.isFinite(arm) || arm <= 0 || arm > 100_000) {
      return { ok: false, error: "Trailing-stop armPercent must be greater than 0 and at most 100000" };
    }
    if (typeof exit !== "number" || !Number.isFinite(exit) || exit < -100 || exit > 100_000) {
      return { ok: false, error: "Trailing-stop exitPercent must be between -100 and 100000" };
    }
    const clean = { armPercent: arm, exitPercent: exit };
    if (typeof rule._id === "string" && rule._id.length <= 64) clean._id = rule._id; // keeps armed-rule ids stable across edits
    out.push(clean);
  }
  return { ok: true, value: out };
}

/**
 * Validates the numeric / trailing-stop fields present in `patch` (only keys in `fields` are looked at).
 * Returns { ok: true, values } with the accepted fields (by their ORIGINAL key), or { ok: false, error } for the first bad one.
 * @param {Record<string, any>} patch
 * @param {string[]} fields
 * @param {{ nullable?: string[] }} [opts] fields that may be `null` (clears an override / disables a limit)
 * @returns {{ ok: boolean, values: Record<string, number | null>, error?: string }}
 */
export function validateSettingsPatch(patch, fields, { nullable = [] } = {}) {
  const values = {};
  for (const key of fields) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const v = patch[key];
    if (v === null && nullable.includes(key)) {
      values[key] = null; // e.g. clearing a per-trader override
      continue;
    }
    const res = validateField(key, v);
    if (!res.ok) return { ok: false, values: {}, error: res.error };
    values[key] = /** @type {number | null} */ (res.value);
  }
  return { ok: true, values };
}

/** True for a plausible Mongo ObjectId string - used before an id from a URL or body reaches a query. */
export function isObjectIdString(value) {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}
