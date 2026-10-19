import { Wallet } from "./models/Wallet.js";
import { Profile } from "./models/Profile.js";

/**
 * Wallets and profiles are either "simulation" (every existing one - the default, so documents from before this
 * field existed count as simulation) or "live" (real funds, added later). The operations that exist purely to
 * play with simulated money - resets, balance top-ups/deductions, forking trade history, deleting, the daily
 * balance refill - must never run against a live one: they would overwrite or fabricate balances that have to
 * match the chain. They all call these guards first.
 */
export class LiveModeError extends Error {
  constructor(action) {
    super(`${action} is only available for simulation wallets/profiles, not live ones`);
    this.name = "LiveModeError";
    this.status = 409;
  }
}

export function isLive(doc) {
  return doc?.mode === "live";
}

export async function assertWalletSimulation(walletId, action) {
  const wallet = await Wallet.findById(walletId, { mode: 1 }).lean();
  if (isLive(wallet)) throw new LiveModeError(action);
}

export async function assertProfileSimulation(profileId, action) {
  const profile = await Profile.findById(profileId, { mode: 1 }).lean();
  if (isLive(profile)) throw new LiveModeError(action);
}
