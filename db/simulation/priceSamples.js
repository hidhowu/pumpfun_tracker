/**
 * Folds one observed price into an OPEN position's recorded peak and trough
 * (maxValueUsd/maxUnrealized* and minValueUsd/minUnrealized*). Works for
 * both SimPosition and WalletPosition (same fields).
 *
 * Every place that prices an open position should call this - not only the
 * daemon's risk sweep. The dashboard runs in a separate process with its own
 * price lookups, and it used to show a live "current" P&L that the sweep had
 * never seen, so the open-trade view could read "+58% now, peak +10%". With
 * every observed price recorded, the peak can never be below a price that
 * was actually displayed.
 *
 * Conditional writes ($lt / $gt in the filter) keep this race-safe against
 * the sweep and other viewers updating the same position concurrently: a
 * write only lands if it's still a new high/low at write time.
 */
export async function recordPriceSample(Model, position, currentValueUsd) {
  if (!Number.isFinite(currentValueUsd)) return;
  const totalCost = (position.costBasisUsd || 0) + (position.buyFeeUsd || 0);
  const unrealizedUsd = currentValueUsd - totalCost;
  const unrealizedPercent = totalCost > 0 ? (unrealizedUsd / totalCost) * 100 : 0;

  const writes = [];
  if (position.maxValueUsd == null || currentValueUsd > position.maxValueUsd) {
    writes.push(
      Model.updateOne(
        { _id: position._id, status: "open", $or: [{ maxValueUsd: null }, { maxValueUsd: { $lt: currentValueUsd } }] },
        { $set: { maxValueUsd: currentValueUsd, maxUnrealizedPnlUsd: unrealizedUsd, maxUnrealizedPnlPercent: unrealizedPercent } }
      )
    );
  }
  if (position.minValueUsd == null || currentValueUsd < position.minValueUsd) {
    writes.push(
      Model.updateOne(
        { _id: position._id, status: "open", $or: [{ minValueUsd: null }, { minValueUsd: { $gt: currentValueUsd } }] },
        { $set: { minValueUsd: currentValueUsd, minUnrealizedPnlUsd: unrealizedUsd, minUnrealizedPnlPercent: unrealizedPercent } }
      )
    );
  }
  await Promise.all(writes);
}

/** The position as it should be displayed right after recordPriceSample - so the view never shows a peak below the current reading. */
export function withPriceSample(position, currentValueUsd, unrealizedUsd, unrealizedPercent) {
  const next = { ...position };
  if (next.maxValueUsd == null || currentValueUsd > next.maxValueUsd) {
    Object.assign(next, { maxValueUsd: currentValueUsd, maxUnrealizedPnlUsd: unrealizedUsd, maxUnrealizedPnlPercent: unrealizedPercent });
  }
  if (next.minValueUsd == null || currentValueUsd < next.minValueUsd) {
    Object.assign(next, { minValueUsd: currentValueUsd, minUnrealizedPnlUsd: unrealizedUsd, minUnrealizedPnlPercent: unrealizedPercent });
  }
  return next;
}
