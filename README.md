# pump.fun copy-trade simulator

Watches a set of Solana wallets, mirrors their pump.fun buy/sell activity
with simulated (paper) capital, and tracks the resulting P&L — so you can
tell which tracked traders are actually worth copying for real, before
risking real money.

Two processes, sharing one MongoDB database:

1. **Tracker daemon** (`src/tracker.js`) — watches wallet logs in real time
   (`logsSubscribe`, commitment `"processed"`), parses any signature that
   mentions a watched wallet, extracts pump.fun/pump.fun-amm buy/sell trades,
   records them, and runs them through the **simulation engine**
   (`db/simulation/`): dust/duplicate checks, a simulated execution delay,
   flat fees, stop-loss monitoring, and daily P&L snapshots. Which wallets it
   watches is driven entirely by the `Trader` collection (`status: "active"`),
   polled every 15s — so adding/blacklisting/unblacklisting a trader from the
   dashboard takes effect within seconds, no restart needed.
2. **Dashboard** (Next.js, `app/`) — a local-only (no login) admin UI: trader
   list with live sim balance/PnL, a leaderboard ranked by realized
   performance, per-trader detail (balance, open positions, closed trades,
   P&L breakdown, settings overrides), bulk add (duplicate-protected),
   blacklist/unblacklist (history is kept, never deleted), and global vs.
   per-trader simulation settings.

## How the simulation works

When a **buy** is detected for a tracked (non-blacklisted) trader:

- Skipped if we've **ever** bought this mint for this trader before — permanent,
  even after selling it. We never buy the same mint twice for the same trader.
- Skipped if the trade's current USD value is below the **dust-buy threshold**
  (default $20) — we keep watching for a later, qualifying buy of the same mint.
- Otherwise, queued to fill after an **execution delay** (default 2s, models
  real trade-processing latency) for a fixed **trade size** (default $20,
  independent of what the real trader spent), regardless of their allocation).
- On fill: token amount = trade size ÷ the mint's *current* pump.fun price
  (not the trader's own fill price — we price as if buying right now, which
  is what a real bot would do). Fees are paid on top and don't buy tokens:
  the **pump fee** (default 1.25% of the trade value - pump.fun's on-chain
  0.95% protocol + 0.30% creator fee) plus a flat **Jito fee** in USD per
  transaction (tip + priority fee). The buy fee hits realized P&L
  immediately (see `db/fees.js`).
- If **negative balance is disabled** for this trader and their balance can't
  cover the trade size, the buy is skipped entirely (not queued) until they
  have enough balance again (from a sale or a manual top-up).

When a **sell** is detected:

- Ignored if we don't hold that mint (never bought, or the buy was dust).
- Ignored if it's a **dust sell** — under a configurable % of the trader's
  *total bought amount* for that mint, not a raw USD check. This matters:
  a full exit at a crashed price still counts as real and triggers our sell,
  even though its USD value alone might look tiny.
- Otherwise, queued (same execution delay) to sell our **entire** position —
  even if the real trader only sold a fraction. The same pump fee % (of the
  gross proceeds) plus the Jito fee comes out of the sale, giving the fully
  realized P&L.

Independent of the trader's own actions, an open position is force-closed if
its unrealized loss breaches the trader's **stop-loss %** (disabled by
default — a global/per-trader setting). Balance can go **negative** by
default (tracked: how many times, and the deepest point reached) — turn it
off globally or per trader to hard-stop buys instead.

**Two P&L numbers**, both tracked daily/weekly/monthly with streaks:
- **Actualized** — start-of-day vs. end-of-day total simulated portfolio value
  (balance + whatever's still open). Exposed to what's currently held.
- **Combined** — the sum of each individually *closed* trade's % return in the
  period (e.g. three closed trades at +50%/+30%/-10% in one day = "+70%
  combined" that day). Realized only, nothing open counts. This is the "are
  their closed decisions actually good, or did one lucky trade paper over a
  losing streak" number — see the leaderboard and per-trader streak stats.

All of the above (allocation, trade size, dust thresholds, stop-loss,
negative-balance, execution delay, pump fee %, Jito fee) has a **global default** and can be
**overridden per trader**; `null` on a trader's override means "inherit the
global default."

## Module map

```
src/env.js               loads .env, exports { rpcUrls, wsUrls, trackedAddresses, commitment }
src/rpcPool.js            RpcPool - spreads HTTP RPC calls randomly across multiple endpoints
src/idlRegistry.js        loads idl/pump.json + idl/pump_amm.json into Anchor coders
src/logStack.js           attributes "Program data:" log lines to the program that emitted them
src/parseTransaction.js   parseTransaction(signature, rpcPool) -> { summary, parsedTransaction }
src/extractPumpTrades.js  extractPumpTrades(parsed, opts) -> [{ type, mint, wallet, tokenAmount, solAmount, ... }]
src/logSubscriber.js      LogSubscriber - WS logsSubscribe for N addresses, add/remove anytime
src/tracker.js            TrackerService - wires everything below into the daemon (also the CLI entry)

db/connect.js             shared Mongoose connection (used by both the daemon and the Next.js API)
db/models/                Trader, Trade, PositionLot, SimPosition, PendingExecution, DailySnapshot,
                           BalanceAdjustment, GlobalSettings
db/traderService.js       addTrader/addTradersBulk (dup-protected), blacklist/mute, settings overrides, adjustBalance
db/settings.js            resolveTraderSettings() - override ?? global default, per field
db/positionLedger.js      recordTrade() - persists a REAL trade + FIFO PositionLots -> the trader's own on-chain PnL
db/onchainPrice.js        live prices from the chain: bonding curve, or the PumpSwap pool once graduated (batched RPC)
db/pumpFunApi.js          getPrice() - on-chain first, pump.fun API fallback; fills always read fresh, never cached
db/fees.js                pump fee % + Jito fee per buy/sell
db/pnl.js                 computeDailyPnl / computeRangePnl / streaks (actualized + combined)
db/simulation/init.js     first-time balance initialization for a trader
db/simulation/engine.js   evaluateRealTrade() - dust/dup decisions, queues a PendingExecution
db/simulation/executor.js processDuePendingExecutions() (fills queued buys/sells), checkStopLosses()
db/simulation/snapshot.js daily portfolio-value snapshots (baseline for actualized P&L)

app/api/traders/…         REST API: list/add, get/patch one, per-trader settings, balance, positions, trade history, pnl
app/api/settings/         global simulation defaults
app/api/leaderboard/      ranks active traders by weekly (or day/month) combined P&L
app/, components/, lib/   the dashboard UI (Next.js App Router + Tailwind v4 + shadcn/ui + Lucide icons)
```

## A note on pump.fun's API and Node's `fetch`

`db/pumpFunApi.js` shells out to `curl` instead of using Node's native
`fetch`. This isn't stylistic — pump.fun's frontend API (`frontend-api-v3.pump.fun`)
blocks Node's `fetch`/undici outright (HTTP 403, every time, even with a
browser `User-Agent` set), while plain `curl` gets HTTP 200 reliably. That's
consistent with TLS/HTTP-client fingerprinting (e.g. Cloudflare-style bot
protection) rather than a header check. If you ever see this start failing
again (pump.fun could tighten things further), that's the first thing to
re-verify — `curl -s https://frontend-api-v3.pump.fun/coins-v3/<any-mint>` should
return 200 with JSON; if even curl stops working, the API itself changed.

## Setup

```
npm install
cp .env.example .env   # then fill in your RPC/WS URLs
```

Requires a running MongoDB (the default `.env` points at a local install:
`mongodb://127.0.0.1:27017/pumpfun_tracker` — swap this for a cloud
connection string later; nothing else in the app needs to change) and `curl`
on PATH (present by default on Windows 10+ and virtually every Unix system).

`.env`:

```
SOLANA_RPC_URLS=https://api.mainnet-beta.solana.com,https://your-provider/v2/KEY
SOLANA_WS_URLS=wss://api.mainnet-beta.solana.com
SOLANA_COMMITMENT=processed
TRACKED_ADDRESSES=
MONGODB_URI=mongodb://127.0.0.1:27017/pumpfun_tracker
PUMP_FUN_API_BASE=https://frontend-api-v3.pump.fun
```

- `SOLANA_RPC_URLS` — comma-separated HTTP endpoints, picked at random per
  call to spread load across providers' rate limits.
- `SOLANA_WS_URLS` — comma-separated WS endpoints for `logsSubscribe`. **Not
  every provider/plan supports this method** (e.g. Alchemy's default
  free-tier WS gateway returns `"Method not found"` for it) — the public
  endpoint always supports it and is a safe default/fallback.
- `SOLANA_COMMITMENT` — use `processed` (fastest) or `confirmed`. Never
  `finalized` for live tracking; it lags well behind the chain tip.
- `TRACKED_ADDRESSES` — wallets to seed into MongoDB on first boot (or pass
  as CLI args to `node src/tracker.js`). After that, manage traders from the
  dashboard.

## Running it

Two processes, in two terminals:

```
npm run dev      # the dashboard, http://localhost:3000
npm run track    # the tracker daemon
```

They're independent — restarting the dashboard never drops a live log
subscription, and the tracker keeps writing to MongoDB regardless of whether
the dashboard is open.

## The "missed transactions" bug (fixed)

If a trader made several trades close together and only one showed up: the
old code called `getTransaction` with no `commitment` param (defaults to
`"finalized"`, which takes 13-30s+ on mainnet) and no retry — a null result
threw immediately and the trade was silently dropped. Fixed in
`src/parseTransaction.js`'s `fetchTransaction`: it now requests `"confirmed"`
(the fastest level `getTransaction` actually supports) and retries with
backoff (up to ~11s total) to bridge the gap between the WS notification and
the transaction actually being fetchable.

## Parse one signature by hand

The parser and extractor are also usable completely on their own:

```
node src/parseTransaction.js <signature> [<signature> ...]
```

Writes `output/<signature>.json` (full `summary` + `parsedTransaction`) and
prints a one-line-per-event digest.

## How decoding works

- System / SPL Token / Token-2022 / Associated Token Account instructions are
  decoded via the RPC's own `jsonParsed` encoding.
- pump.fun (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) and pump.fun-amm
  (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`) instructions and events are
  decoded with their official Anchor IDLs (`idl/pump.json`, `idl/pump_amm.json`,
  from `pump-fun/pump-public-docs` on GitHub) via `@coral-xyz/anchor`'s
  `BorshInstructionCoder`/`BorshEventCoder`.
- Anything from an unrecognized program is kept as `source: "raw"` — nothing
  is silently dropped.

## Tested against (real mainnet signatures + a live end-to-end run)

- Router-wrapped buy — `3K69xtqw9EBpptxhq5cTXkQiCzjLU5ai84uKV9EjqV9mfYip1mSXvRoSthh8ud31xWiXSG5bdtLe9ivFG9dCuQ9f`
- Direct pump.fun buy — `38gEx3gLJLC3AJEDSZmpB5vc21mV1y1Z4zeR6D7XCGn5HJSdXGKPUGh5rwTaVnUThmxfEfoHiH44KSYXxXTq7e3i`
- pump.fun sell — `3sSMGLAwN2itCK3mq6LzyWVGpirXZU5hxLq2MV4GqPzSpXHKsU2yXb71kJnqiiQmaHgZtFvyS4WF23KJ8aKU85jp`
- Token create + buy in one tx — `3meczDpKQS2Cx1wgLtRthxCn72iK9HJ7iDrkVx2sFQzqg5tCL6bqcz1xnidEfduaGFwszHMbdaTB47KbH2cmhWDZ`
- pump.fun-**amm** sell quoted in a non-SOL token — `NS74szBLXQ9qB1RMbiap83fTZDuxs54MB6Guocvu8MmFke6eMWNaHvaXwPBzH7XhtyPQaNjaE5FxfqqtqNSWJbr`
- Simulation engine: end-to-end tested with real trader addresses and real
  pump.fun price data — dust-buy skip, execution-delay fill with correct fee
  deduction, permanent per-mint dup-block, dust-sell fraction check (including
  the "full exit at a crashed price still counts" case), stop-loss force-close,
  and exact P&L math all verified against expected values.
- Full stack live: tracker daemon running continuously against 12 real
  tracked wallets with the simulation loops active, zero errors.

## Next steps (not built yet, by design)

- A way to add/remove tracked addresses from outside the dashboard (an
  external API/webhook) — `TrackerService`/`addTradersBulk` already support
  this, they just need wiring to whatever the next integration is.
- Live unrealized P&L on the open-positions list (currently shows cost basis;
  would need a live-priced positions endpoint).
