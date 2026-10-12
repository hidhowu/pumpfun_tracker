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
2. **Dashboard** (Next.js, `app/`) — a sign-in-protected admin UI: trader
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

## Backtest

Replays an address's last N days of pump.fun trades as a copy-trade with a
chosen profile's settings, so unprofitable addresses can be dropped without
waiting days for live results. Lives in `db/backtest/`, runs in its own
process (`npm run backtest`, or pm2 app `pumpfun-tracker-backtest`) fed by
MongoDB jobs - the dashboard (Backtest menu) only creates and reads them, so
closing the page never stops anything and a restart resumes where it left off.

Per address, in two stages (both resumable, progress and partial P&L visible live):

1. **Collect** - the address's buys and sells for the window, cached per address
   (`BacktestTx`, coverage in `BacktestScan`), so a later, longer backtest only
   fetches the missing days. Two sources:
   - **pump.fun user-trades API (fast, preferred)** - the swaps come ready-made
     from
     `frontend-api-v3.pump.fun/user-trades/<userId>?types=trades&limit=100`,
     paged by cursor (`<unix microseconds>:<uuid>`, newest first) through the
     proxy pool: a few dozen requests instead of listing and parsing thousands
     of transactions. The endpoint takes the wallet address in place of the
     `userId`, so an address added without one works too. Quirk handled: the
     endpoint now and then returns an empty 200 page with the same cursor
     mid-history (a missing `nextCursor` is the real end). That page is retried
     10 times through different proxies; if it persists, the previous page is
     read again for a fresh cursor and the next page asked for again (3 rounds);
     if that fails the whole address restarts with the wallet address in place of
     the `userId` (or vice versa), then once more allowed to rebuild the cursor a
     little further back (can skip a short gap). Quote assets (wSOL, USDC, USDT)
     are ignored. Add addresses as JSON (`[{ "walletAddress": "...", "userId":
     "..." }]`, a single object works too); re-pasting a listed address with an id
     upgrades it.
   - **RPC (slow fallback)** - only if the API still gives blank pages after all
     of that: `getSignaturesForAddress` back to the window start, then each
     successful transaction through `parseTransaction`/`extractPumpTrades`.

   The per-backtest "skip addresses with more than N signatures" limit counts
   signatures on the RPC path and trades on the API path.
2. **Simulate** - per token: the first non-dust buy and the first non-dust sell
   after it (same dust rules as live). Timing follows live, and all three values
   are copied from the profile / live settings when the backtest starts and can be
   edited in the New backtest dialog (or later, while paused):
   - **Execution delay** (`executionDelaySeconds`, from the profile) plus an
     **extra reaction time** (`fillLatencySeconds`, default 3s - what live loses
     noticing a trade and queueing the order; Backtest -> Backtest settings). Our
     buy fills that long after the trader's buy, at the pool price then (`priceUsd`
     of the first trade at or after that second, from `swap-api.pump.fun`).
   - **Price checks** (`riskCheckIntervalSeconds`, from the live Settings page):
     open trades are looked at only every N seconds, at the pool price of that
     moment, exactly like the live risk sweep - stop-loss, take-profit, max hold
     time and trailing stops are decided on those looks only, so a spike between
     two looks is missed in both. `0` = look at every pool trade (the old behaviour).
   - The exit is the earliest of those decisions or the trader's sell (noticed after
     the same reaction time), and fills after the execution delay.

   Trade history is read in gap-free windows (cursor =
   `slotIndexId-timestampMs`, newest first, 100 per page), resized to how busy
   the token is. A backtest made before these settings existed has none of them
   and keeps looking at every pool trade with no extra reaction time.

**Loss traders and speed.** For a long list, a backtest can drop a trader that is
clearly losing instead of simulating every token it bought. Four optional rules,
each off at 0, set when the backtest is created (or edited while paused); any one
that fires drops the trader, which shows as "Skipped / stopped early" with the
reason and keeps the trades simulated so far:

- **Losing days** - this many full UTC days closed in a loss (not necessarily in a row).
- **Day loss** - one full day closed at or below minus this percent (the combined
  percent the daily breakdown shows, e.g. 1000 = -1000%).
- **Negative balance** - the simulated wallet's cash went below zero this many times
  (the "negative balance events" of the address page; needs a profile that allows a
  negative balance).
- **Still losing at N% of tokens** - once N% of its tokens are processed the realized
  P&L is still negative.

A day only counts once the simulation has fully passed it, so a rule never fires on a
figure that can still change. Changing the rules puts the traders stopped earlier back
in the queue to be judged again; the results are kept. **Addresses at once** is set per
backtest (empty = automatic; 1 = one address at a time so it gets every proxy) and may
be changed while it runs.

**Picking steady traders.** Each address in a backtest also shows how its profit is
spread over the days (a day = a UTC day with a closed trade, using its combined %):
**Loss days** (days that closed in a loss), **Profit margin** = (profit days - loss
days) / profit days, e.g. +100% and -20% give 80% (losses took 20% of the profit; near 0
means the losing days ate almost everything), and **Without best day**: the result if
the single most profitable day had not happened, flagged "still profit" or "turns loss"
so one lucky day cannot carry a poor trader to the top. The addresses table sorts by
all of these (and Trades / Win rate) and filters by minimum win rate, minimum profit
margin, maximum loss days, minimum trades and "still profitable without best day"; the
address page has the same figures in a Consistency card.

Speed is set by proxies (pump.fun allows ~1 request/s per IP; requests are
round-robined with a per-proxy rate limit and `Retry-After` cooldowns) and RPCs
(per-endpoint rate limit). On the RPC page an endpoint can be set to **Backtests
only** so slow providers never serve live trading; endpoints shared with live
run at a fraction of the rate. Concurrency defaults are derived from the number
of proxies/RPCs (Backtest -> Backtest settings).

Every proxy is used at once: the pump.fun client keeps one request in flight per
proxy (73 proxies = 73 at a time) while each proxy is still paced individually, and a
proxy that is refused rests while the request goes straight to another. Reading one
address's history is split into time slices read in parallel (the newest page tells
how busy the wallet is, so quiet wallets stay at one page), and "Trades at once" is
one shared pool across all addresses (auto = one per proxy), so a single address can
use the whole pool.

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
SESSION_SECRET=<48+ random characters>
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

## Sign-in

Every page and every `/api` route requires a signed-in session. There is no
sign-up page: accounts are created from the server's shell only.

```
npm run user -- create <username>    # prompts for the password (hidden)
npm run user -- passwd <username>    # reset a password; signs out its sessions
npm run user -- list | signout <username> | unlock <username> | delete <username>
```

`SESSION_SECRET` must be set in `.env` (see `.env.example`) or the dashboard
refuses to serve anything. Passwords: 12+ characters, 3 of lowercase /
uppercase / digits / symbols, stored as scrypt hashes. Sessions end after
12h idle or 7 days, and can be revoked server-side. 5 wrong passwords for a
username (or 30 from one IP) within 15 minutes locks further attempts.

How it's enforced: `proxy.ts` turns away any request without a validly
signed session cookie (deny by default, so new routes are covered
automatically), and every route handler also verifies the session against
the database — new API routes must start with:

```ts
const denied = await requireApiSession();
if (denied) return denied;
```

**Serve the dashboard over HTTPS** (e.g. a TLS reverse proxy in front of
`next start`) — over plain HTTP the password and session cookie cross the
network unencrypted. The login page warns when it's loaded over HTTP.

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
