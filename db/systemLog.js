import { SystemLog } from "./models/SystemLog.js";

/**
 * Fire-and-forget log write for the "Logs" UI section. Never allowed to
 * throw into the caller - a logging failure must not break tracking or
 * simulation, it should just... not get logged (and print to console as a
 * last-resort trace for whoever's watching the terminal/PM2 output).
 */
export async function logEvent(category, message, { level = "info", meta = null } = {}) {
  try {
    await SystemLog.create({ category, level, message, meta });
  } catch (err) {
    console.error("[systemLog] failed to write log entry:", err.message || err);
  }
}
