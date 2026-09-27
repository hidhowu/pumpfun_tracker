import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { BorshInstructionCoder, BorshEventCoder } from "@coral-xyz/anchor";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadIdl(file) {
  const idl = JSON.parse(readFileSync(path.join(__dirname, "..", "idl", file), "utf8"));
  return idl;
}

const REGISTRY = [
  { label: "pump.fun", file: "pump.json" },
  { label: "pump.fun-amm", file: "pump_amm.json" },
];

// programId -> { label, idl, instructionCoder, eventCoder }
export const programs = new Map();

for (const { label, file } of REGISTRY) {
  const idl = loadIdl(file);
  const instructionCoder = new BorshInstructionCoder(idl);
  let eventCoder = null;
  try {
    eventCoder = new BorshEventCoder(idl);
  } catch {
    eventCoder = null;
  }
  programs.set(idl.address, { label, idl, instructionCoder, eventCoder });
}

export const WELL_KNOWN_PROGRAM_NAMES = {
  "11111111111111111111111111111111": "system",
  ComputeBudget111111111111111111111111111111: "compute-budget",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "spl-token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "spl-token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "associated-token-account",
  ASSoc1E: "associated-token-account",
};

export function getProgramInfo(programId) {
  return programs.get(programId) || null;
}
