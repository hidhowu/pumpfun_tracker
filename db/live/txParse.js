import { WSOL_MINT } from "./tokenMeta.js";

const LAMPORTS_PER_SOL = 1_000_000_000;
// Below this a SOL movement is treated as noise (fee dust), not the other side of a trade.
const DUST_LAMPORTS = 1_000;

/**
 * Turns one `getTransaction` result (jsonParsed, version 0 allowed) into the rows stored for `owner` - see
 * db/models/LiveWalletTx.js for what each kind means. Pure: no network, no database.
 *
 * SOL accounting, all from the wallet's own balance changes:
 *  - wrapped SOL (wSOL) counts as SOL, so swaps that wrap/unwrap through Jupiter look the same as direct ones;
 *  - the network fee is reported separately (it is a cost of the trade, not part of the price);
 *  - rent paid to open a token account, or refunded when one is closed, is taken out of the trade's SOL - it is a
 *    deposit that comes back, not a loss on the token.
 * Jito tips and the pump.fun fee are real costs and stay inside the trade's SOL.
 */
export function parseWalletTransaction(tx, owner) {
  const meta = tx?.meta;
  if (!tx || !meta) return [];
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const ownerIndex = keys.indexOf(owner);
  const feePayer = ownerIndex === 0;
  const feeSol = feePayer ? meta.fee / LAMPORTS_PER_SOL : 0;
  const base = { slot: tx.slot, blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null };

  if (meta.err) return feePayer ? [{ ...base, mint: null, kind: "failed", tokenDelta: 0, solDelta: 0, feeSol }] : [];
  if (ownerIndex < 0) return [];

  const mine = (list) => (list || []).filter((b) => b.owner === owner);
  const pre = mine(meta.preTokenBalances);
  const post = mine(meta.postTokenBalances);
  const preIndexes = new Set(pre.map((b) => b.accountIndex));
  const postIndexes = new Set(post.map((b) => b.accountIndex));

  const deltas = new Map(); // mint -> { raw: bigint, decimals }
  const bump = (b, sign) => {
    const entry = deltas.get(b.mint) ?? { raw: 0n, decimals: b.uiTokenAmount.decimals };
    entry.raw += BigInt(b.uiTokenAmount.amount) * sign;
    deltas.set(b.mint, entry);
  };
  post.forEach((b) => bump(b, 1n));
  pre.forEach((b) => bump(b, -1n));

  let rentOpened = 0;
  let rentRefunded = 0;
  for (const b of post) if (!preIndexes.has(b.accountIndex) && b.mint !== WSOL_MINT) rentOpened += meta.postBalances[b.accountIndex];
  for (const b of pre) if (!postIndexes.has(b.accountIndex) && b.mint !== WSOL_MINT) rentRefunded += meta.preBalances[b.accountIndex];

  const wsolLamports = Number(deltas.get(WSOL_MINT)?.raw ?? 0n);
  const solChange = meta.postBalances[ownerIndex] - meta.preBalances[ownerIndex] + wsolLamports;
  const feeLamports = feePayer ? meta.fee : 0;
  const flow = solChange + feeLamports - rentOpened + rentRefunded; // SOL moved by the trade itself

  const legs = [...deltas].filter(([mint, d]) => mint !== WSOL_MINT && d.raw !== 0n);
  const row = (fields) => ({ ...base, tokenDelta: 0, solDelta: 0, feeSol: 0, ...fields });

  if (legs.length === 0) {
    if (Math.abs(flow) >= DUST_LAMPORTS) return [row({ mint: null, kind: flow > 0 ? "sol_in" : "sol_out", solDelta: flow / LAMPORTS_PER_SOL, feeSol })];
    return feeSol > 0 ? [row({ mint: null, kind: "other", feeSol })] : [];
  }

  return legs.map(([mint, d], i) => {
    const amount = Number(d.raw) / 10 ** d.decimals;
    let kind = amount > 0 ? "receive" : "send";
    let solDelta = 0;
    // Only an unambiguous single-token swap against SOL is a buy/sell; anything else is just a movement of tokens.
    if (legs.length === 1) {
      if (amount > 0 && flow <= -DUST_LAMPORTS) kind = "buy";
      else if (amount < 0 && flow >= DUST_LAMPORTS) kind = "sell";
      if (kind === "buy" || kind === "sell") solDelta = flow / LAMPORTS_PER_SOL;
    }
    return row({ mint, kind, tokenDelta: amount, solDelta, feeSol: i === 0 ? feeSol : 0 });
  });
}
