import { UnpricedTrade } from "../models/UnpricedTrade.js";
import { logEvent } from "../systemLog.js";

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A buy had no USD value, so `wallet` did not copy it: remember it (once per trade - every wallet that skips it is added to the same row) and say so in
 * the Logs feed. Never throws: failing to write this note must not stop the other wallets from evaluating the trade.
 * @param {object} trade as db/simulation/detectedTrade.js builds it; `trade.feed` = { quoteMint, hops, venue } as the feed reported them
 */
export async function recordUnpricedBuy(trade, wallet) {
  try {
    const key = { signature: trade.signature, traderAddress: trade.wallet, mint: trade.mint, type: trade.type };
    const res = await UnpricedTrade.updateOne(
      key,
      {
        $setOnInsert: {
          blockTime: trade.blockTime ?? null,
          tokenAmount: trade.tokenAmount ?? null,
          quoteMint: trade.feed?.quoteMint ?? null,
          hops: trade.feed?.hops ?? null,
          venue: trade.feed?.venue ?? null,
          trackingMethod: wallet.settings?.trackingMethod ?? null,
          firstSeenAt: new Date(),
          purgeAt: new Date(Date.now() + KEEP_MS),
        },
        $addToSet: { walletIds: wallet._id },
      },
      { upsert: true }
    );
    if (res.upsertedCount > 0) {
      logEvent(
        "trade",
        `Not copied - no USD value for ${trade.wallet}'s buy of ${trade.mint} (tx ${trade.signature}, paid with ${trade.feed?.quoteMint ?? "an unknown token"}${trade.feed?.hops > 1 ? `, ${trade.feed.hops} hops` : ""}); saved in the unpriced-trades list`,
        { level: "warn", meta: { traderAddress: trade.wallet, signature: trade.signature, mint: trade.mint, quoteMint: trade.feed?.quoteMint ?? null } }
      );
    }
  } catch (err) {
    console.error("[unpricedLog] could not record an unpriced buy:", err.message || err);
  }
}
