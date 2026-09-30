import { WalletPosition } from "../models/WalletPosition.js";
import { getCoinInfo, priceFromCoinInfo } from "../pumpFunApi.js";

/** Wallet-scoped mirror of db/simulation/positionsView.js's markOpenPositions. */
export async function markOpenWalletPositions(positions) {
  return Promise.all(
    positions.map(async (position) => {
      const coin = await getCoinInfo(position.mint).catch(() => null);
      const price = priceFromCoinInfo(coin);
      const totalCost = position.costBasisUsd + position.buyFeeUsd;

      if (!price?.priceUsd) {
        return { ...position, currentPriceUsd: null, currentValueUsd: null, unrealizedPnlUsd: null, unrealizedPnlPercent: null };
      }

      const currentValueUsd = position.tokenAmount * price.priceUsd;
      const unrealizedPnlUsd = currentValueUsd - totalCost;
      const unrealizedPnlPercent = totalCost > 0 ? (unrealizedPnlUsd / totalCost) * 100 : 0;

      return { ...position, currentPriceUsd: price.priceUsd, currentValueUsd, unrealizedPnlUsd, unrealizedPnlPercent };
    })
  );
}

/** Fetches + marks a wallet's open positions (optionally narrowed to one trader) in one call. */
export async function getMarkedOpenWalletPositions(walletId, traderAddress) {
  const filter = traderAddress ? { walletId, traderAddress, status: "open" } : { walletId, status: "open" };
  const positions = await WalletPosition.find(filter).lean();
  return markOpenWalletPositions(positions);
}
