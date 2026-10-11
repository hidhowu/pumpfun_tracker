module.exports = {
  apps: [
    {
      name: "pumpfun-tracker-web",
      cwd: __dirname,
      script: "npx",
      args: "next start -p 4001 -H 127.0.0.1",
      interpreter: "none",
      env: { PORT: "4001" },
    },
    {
      name: "pumpfun-tracker-daemon",
      cwd: __dirname,
      script: "src/tracker.js",
      interpreter: "node",
    },
    {
      // Runs backtests (see db/backtest/). Separate from the daemon so a long backtest can never slow live trading.
      name: "pumpfun-tracker-backtest",
      cwd: __dirname,
      script: "src/backtestWorker.js",
      interpreter: "node",
    },
  ],
};
