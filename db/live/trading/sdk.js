import { createRequire } from "node:module";

/**
 * pump.fun's official SDKs (@pump-fun/pump-sdk for the bonding curve, @pump-fun/pump-swap-sdk for the PumpSwap pool a token moves
 * to once it graduates). They are loaded through CommonJS on purpose: their ES-module builds import a dependency in a way Node
 * refuses, while the CommonJS builds load fine. Loading takes a few seconds, so it happens on first use, not at start-up.
 */
const require = createRequire(import.meta.url);
let loaded = null;

export function pumpSdks() {
  if (!loaded) loaded = { pump: require("@pump-fun/pump-sdk"), amm: require("@pump-fun/pump-swap-sdk") };
  return loaded;
}
