/**
wsLatencyTest.js
 * Measures real WS notification latency: for each pump.fun/pump.fun-amm
 * trade seen via logsSubscribe (commitment "processed") on Solana's actual
 * mainnet RPC, decodes the trade event straight out of the notification's
 * own `logs` (using this project's IDL decoder - no getTransaction call, no
 * extra RPC round-trip at all) to read the on-chain `timestamp` the program
 * itself stamped the event with, and compares that to the moment we
 * received the WS notification.
 *
 * latencySeconds = receivedAt - event.timestamp
 *
 * Subscribes to 100 real pump.fun trader wallets (extras/wallets.json),
 * waits for all of them to finish subscribing before counting anything (so
 * a couple of very high-frequency wallets can't fill the whole sample
 * before the rest are even live), then records the first 1000 successful,
 * decodable pump trades. Each row is appended to the CSV the instant it's
 * computed - nothing waits for the full 1000 before being written.
 *
 * Usage: node extras/wsLatencyTest.js
 * Env overrides (useful when running this on a server with a different/
 * better network path than local):
 *   TEST_WS_URL          default wss://api.mainnet-beta.solana.com
 *   TEST_COMMITMENT      default processed
 *   TEST_TARGET_COUNT    default 1000
 *
 * Output: extras/wsLatencyTest-results.csv (appended to live), plus a
 * summary printed at the end.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProgramInfo } from "../src/idlRegistry.js";
import { extractProgramDataEvents } from "../src/logStack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WS_URL = "wss://api.mainnet-beta.solana.com";
const COMMITMENT = process.env.TEST_COMMITMENT || "processed";
const TARGET_COUNT = Number(process.env.TEST_TARGET_COUNT || 1000);
const SUBSCRIBE_STAGGER_MS = 250; // spread out logsSubscribe calls so the endpoint's rate limit isn't tripped on connect
const SAFETY_TIMEOUT_MS = 30 * 60 * 1000; // give up after 30 min no matter what

const TRADE_EVENT_NAMES = new Set(["TradeEvent", "BuyEvent", "SellEvent"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadWallets() {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, "wallets.json"), "utf8"),
  );
  const addresses = raw.entries.map((e) => e.walletAddress).filter(Boolean);
  return [...new Set(addresses)].slice(0, 100);
}

/** Pulls the first decodable pump trade event (with a timestamp) out of a notification's logs, or null. */
function decodeFirstTradeEvent(logs) {
  for (const { programId, dataBase64 } of extractProgramDataEvents(logs)) {
    const programInfo = getProgramInfo(programId);
    if (!programInfo || !programInfo.eventCoder) continue;
    const decoded = programInfo.eventCoder.decode(dataBase64);
    if (!decoded || !TRADE_EVENT_NAMES.has(decoded.name)) continue;
    const timestamp = decoded.data?.timestamp;
    if (timestamp === undefined || timestamp === null) continue;
    return {
      program: programInfo.label,
      eventName: decoded.name,
      timestamp: Number(timestamp.toString()),
    };
  }
  return null;
}

async function main() {
  const wallets = loadWallets();
  console.log(
    `Loaded ${wallets.length} wallet addresses from extras/wallets.json`,
  );
  console.log(
    `WS: ${WS_URL}  commitment: ${COMMITMENT}  target: ${TARGET_COUNT} successful pump trades`,
  );

  const csvPath = path.join(__dirname, "wsLatencyTest-results2.csv");
  fs.writeFileSync(
    csvPath,
    "signature,address,program,eventName,eventTimestamp,receivedAtMs,latencySeconds,latencyMs\n",
  );
  console.log(`CSV (appending live): ${csvPath}`);

  const ws = new WebSocket(WS_URL);
  let nextId = 1;
  const pending = new Map();
  const subIdToAddress = new Map();
  const seenSignatures = new Set();
  const latencies = []; // seconds, kept only for the end-of-run summary

  let doneResolve;
  const donePromise = new Promise((resolve) => (doneResolve = resolve));
  let finished = false;
  // Gate: ignore notifications until every wallet has finished (attempting)
  // subscription, so the target count can't be filled entirely by whichever
  // few wallets happen to subscribe first.
  let subscribingComplete = false;

  function finish(reason) {
    if (finished) return;
    finished = true;
    console.log(`\nStopping: ${reason} (${latencies.length} rows written)`);
    doneResolve();
  }

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  ws.addEventListener("open", async () => {
    console.log(
      "WS connected. Subscribing to logsSubscribe for each wallet...",
    );
    for (const address of wallets) {
      if (finished) break;
      try {
        const subId = await send("logsSubscribe", [
          { mentions: [address] },
          { commitment: COMMITMENT },
        ]);
        subIdToAddress.set(subId, address);
      } catch (err) {
        console.error(`subscribe failed for ${address}: ${err.message}`);
      }
      await sleep(SUBSCRIBE_STAGGER_MS);
    }
    subscribingComplete = true;
    console.log(
      `Subscribed to ${subIdToAddress.size}/${wallets.length} wallets. Waiting for trades...`,
    );
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.method === "logsNotification") {
      const receivedAtMs = Date.now(); // captured first, before any decoding work
      if (!subscribingComplete || finished) return;
      const address = subIdToAddress.get(msg.params.subscription);
      const { signature, err, logs } = msg.params.result.value;
      if (err) return; // only successful trades count
      if (seenSignatures.has(signature)) return;
      const trade = decodeFirstTradeEvent(logs);
      if (!trade) return; // not a decodable pump.fun/pump.fun-amm trade - skip
      seenSignatures.add(signature);

      const latencySeconds = receivedAtMs / 1000 - trade.timestamp;
      const latencyMs = receivedAtMs - trade.timestamp * 1000;
      latencies.push(latencySeconds);

      const row = [
        signature,
        address,
        trade.program,
        trade.eventName,
        trade.timestamp,
        receivedAtMs,
        latencySeconds.toFixed(3),
        latencyMs,
      ].join(",");
      fs.appendFileSync(csvPath, row + "\n");

      if (latencies.length % 50 === 0 || latencies.length === TARGET_COUNT) {
        console.log(
          `... ${latencies.length}/${TARGET_COUNT} trades written (last latency: ${latencySeconds.toFixed(3)}s)`,
        );
      }
      if (latencies.length >= TARGET_COUNT) finish("reached target count");
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  ws.addEventListener("error", (err) => {
    console.error("WS error:", err.error || err);
  });
  ws.addEventListener("close", () => {
    console.log("WS closed.");
    finish("connection closed");
  });

  const safetyTimer = setTimeout(
    () => finish("30-minute safety timeout"),
    SAFETY_TIMEOUT_MS,
  );
  await donePromise;
  clearTimeout(safetyTimer);
  try {
    ws.close();
  } catch {
    // best-effort
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (p) =>
    sorted.length
      ? sorted[
          Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
        ]
      : null;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const summary = {
    walletsSubscribed: subIdToAddress.size,
    tradesRecorded: sorted.length,
    latencySecondsMin: sorted[0] ?? null,
    latencySecondsMax: sorted[sorted.length - 1] ?? null,
    latencySecondsMean: sorted.length ? sum / sorted.length : null,
    latencySecondsMedian: pct(50),
    latencySecondsP90: pct(90),
    latencySecondsP95: pct(95),
    latencySecondsP99: pct(99),
  };

  console.log("\n=== Summary ===");
  console.table(summary);
  console.log(`CSV: ${csvPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
