#!/usr/bin/env node
/**
 * Backtest worker - a separate process from the live tracker daemon on
 * purpose: a backtest is hours of network work and must never be able to slow
 * live trade detection or execution. It takes its jobs from MongoDB
 * (BacktestRun / BacktestRunTrader, created by the dashboard), so closing the
 * dashboard doesn't stop anything, and a restart resumes where it left off.
 */
import path from "path";
import { fileURLToPath } from "url";
import "./env.js";
import { connectDb } from "../db/connect.js";
import { BacktestWorker } from "../db/backtest/runner.js";

async function run() {
  await connectDb();
  const worker = new BacktestWorker();
  await worker.start();
  console.log(`[backtest] worker running (${worker.id}) - jobs are read from MongoDB`);

  const shutdown = async () => {
    console.log("[backtest] shutting down - in-flight addresses will resume on the next start");
    await worker.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// PM2 launches scripts through its own container wrapper, so process.argv[1]
// is not this file's path there - also honour PM2's pm_exec_path.
const isMain = [process.argv[1], process.env.pm_exec_path].some((p) => p && path.resolve(p) === fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((err) => {
    console.error("[backtest] fatal:", err.message || err);
    process.exit(1);
  });
}
