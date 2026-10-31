import { getSystemSettings } from "../../models/SystemSettings.js";
import { logEvent } from "../../systemLog.js";
import { processDueLiveExecutions } from "./executor.js";
import { checkLiveRiskExits } from "./risk.js";
import { SWEEP_EVERY_MS, sweepAllWallets } from "./burnEngine.js";
import { pumpSdks } from "./sdk.js";

const API_PLUS_BEAT_MS = 2000;

/**
 * Starts the three background loops of the live wallets, in the tracker daemon (the process that sees the traders' trades as they happen):
 *  - the trade queue, every 250 ms (several rounds may overlap: each claims its own entries, so one slow landing never holds up another);
 *  - the live wallets' own exit rules, as often as the simulation's risk sweep (the lots of "api_plus" wallets: every 2 seconds, judged at their check moments);
 *  - the burn engine, every 30 minutes.
 * @returns {() => void} stops them
 */
export function startLiveTradingLoops({ onError = (err) => console.error("[live]", err) } = {}) {
  let active = true;
  let rounds = 0;

  // pump.fun's SDKs take a few seconds to load and loading blocks the process, so it is done once, a moment after start - not in the middle of a trade.
  const preload = setTimeout(() => {
    try {
      pumpSdks();
    } catch (err) {
      onError(err);
    }
  }, 4000);
  const MAX_ROUNDS = 4;

  const queueTimer = setInterval(() => {
    if (rounds >= MAX_ROUNDS) return;
    rounds += 1;
    processDueLiveExecutions()
      .catch(onError)
      .finally(() => {
        rounds -= 1;
      });
  }, 250);

  let riskTimer = null;
  const riskLoop = async () => {
    if (!active) return;
    try {
      await checkLiveRiskExits();
    } catch (err) {
      onError(err);
    }
    if (!active) return;
    let seconds = 7;
    try {
      seconds = Math.max(5, (await getSystemSettings()).riskCheckIntervalSeconds || 7);
    } catch (err) {
      onError(err);
    }
    riskTimer = setTimeout(riskLoop, seconds * 1000);
  };
  riskLoop();

  // The lots of "api_plus" wallets are looked at every 2 seconds, but only judged at their own check moments (the risk-check interval, as in the backtest):
  // the short beat finds a moment as soon as its trades are listed, and a slow pass can't push the next look a whole interval away.
  let apiPlusRunning = false;
  const apiPlusTimer = setInterval(() => {
    if (apiPlusRunning) return;
    apiPlusRunning = true;
    checkLiveRiskExits({ apiPlus: true })
      .catch(onError)
      .finally(() => {
        apiPlusRunning = false;
      });
  }, API_PLUS_BEAT_MS);

  // The first burn pass waits a couple of minutes so a restart does not start with it.
  let burning = false;
  const burn = () => {
    if (burning) return;
    burning = true;
    sweepAllWallets()
      .catch((err) => logEvent("tracker", `[live-wallet] Burn engine pass failed: ${err instanceof Error ? err.message : err}`, { level: "error" }))
      .finally(() => {
        burning = false;
      });
  };
  const burnFirst = setTimeout(burn, 2 * 60_000);
  const burnTimer = setInterval(burn, SWEEP_EVERY_MS);

  return () => {
    active = false;
    clearInterval(queueTimer);
    clearInterval(apiPlusTimer);
    clearInterval(burnTimer);
    clearTimeout(burnFirst);
    clearTimeout(preload);
    if (riskTimer) clearTimeout(riskTimer);
  };
}
