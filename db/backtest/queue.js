/**
 * The backtest queue. Backtests are worked ONE AT A TIME so they never compete for the same proxies, RPC endpoints and CPU: the first
 * backtest in line is worked on, the others wait with status "queued", and when it finishes (or is paused / cancelled) the next one starts
 * by itself. Only backtests that are asked to run (control "run") and are queued or running are in the line.
 *
 * The line is ordered by `queuedAt`, oldest first: set when a backtest is created and again whenever it is put back in the line (resume,
 * restart, retry), which sends it to the back. Backtests made before the queue existed have none and use `createdAt`.
 */
export const queueTime = (run) => new Date(run.queuedAt ?? run.createdAt).getTime();

/** Sort comparator: the backtest that should be worked on first comes first. */
export const byQueueOrder = (a, b) => queueTime(a) - queueTime(b) || String(a._id).localeCompare(String(b._id));
