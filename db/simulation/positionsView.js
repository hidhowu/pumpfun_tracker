import { SimPosition } from "../models/SimPosition.js";
import { getPrice } from "../pumpFunApi.js";
import { recordPriceSample, withPriceSample } from "./priceSamples.js";

/**
 * Marks a list of OPEN SimPosition docs (lean or hydrated) with their
 * current price/value and unrealized P&L. Used wherever an open position
 * needs to show "am I in profit right now" - the open-positions list and
 * the simulated-capital balance card both need this.
 */
export async function markOpenPositions(positions) {
  return Promise.all(
    positions.map(async (position) => {
      const price = await getPrice(position.mint);
      const totalCost = position.costBasisUsd + position.buyFeeUsd;

      if (!price?.priceUsd) {
        return {
          ...position,
          currentPriceUsd: null,
          currentValueUsd: null,
          unrealizedPnlUsd: null,
          unrealizedPnlPercent: null,
        };
      }

      const currentValueUsd = position.tokenAmount * price.priceUsd;
      const unrealizedPnlUsd = currentValueUsd - totalCost;
      const unrealizedPnlPercent = totalCost > 0 ? (unrealizedPnlUsd / totalCost) * 100 : 0;
      // The price shown here is a real observation - fold it into the
      // recorded peak/trough so they can never contradict it (see priceSamples.js).
      await recordPriceSample(SimPosition, position, currentValueUsd).catch(() => {});

      return {
        ...withPriceSample(position, currentValueUsd, unrealizedPnlUsd, unrealizedPnlPercent),
        currentPriceUsd: price.priceUsd,
        currentValueUsd,
        unrealizedPnlUsd,
        unrealizedPnlPercent,
      };
    })
  );
}

/** Fetches + marks a trader's open positions, within one profile, in one call. */
export async function getMarkedOpenPositions(profileId, traderAddress) {
  const positions = await SimPosition.find({ profileId, traderAddress, status: "open" }).lean();
  return markOpenPositions(positions);
}

/** Total unrealized P&L (USD) across a trader's open positions in one profile, right now. */
export async function getUnrealizedPnlUsd(profileId, traderAddress) {
  const marked = await getMarkedOpenPositions(profileId, traderAddress);
  return marked.reduce((sum, p) => sum + (p.unrealizedPnlUsd || 0), 0);
}
