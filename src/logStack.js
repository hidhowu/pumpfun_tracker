const INVOKE_RE = /^Program (\w+) invoke \[(\d+)]$/;
const END_RE = /^Program (\w+) (success|failed.*)$/;
const DATA_RE = /^Program data: (.+)$/;
const RETURN_RE = /^Program return: (\w+) (.+)$/;
const INSTRUCTION_RE = /^Program log: Instruction: (\w+)$/;

/**
 * Walks the transaction's logMessages and attributes every
 * "Program data: <base64>" line (Anchor's emit!/sol_log_data events)
 * to the program that was executing when the line was logged, by
 * tracking the invoke/success call stack.
 *
 * Returns an ordered array of { programId, dataBase64, depth }.
 */
export function extractProgramDataEvents(logMessages) {
  const stack = [];
  const events = [];
  let topLevelIndex = -1;
  for (const line of logMessages || []) {
    const invoke = line.match(INVOKE_RE);
    if (invoke) {
      if (stack.length === 0) topLevelIndex += 1;
      stack.push(invoke[1]);
      continue;
    }
    const data = line.match(DATA_RE);
    if (data) {
      const programId = stack[stack.length - 1] || null;
      events.push({ programId, dataBase64: data[1], depth: stack.length, topLevelIndex });
      continue;
    }
    const ret = line.match(RETURN_RE);
    if (ret) continue;
    const end = line.match(END_RE);
    if (end) {
      // Pop the matching program off the top of the stack.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === end[1]) {
          stack.length = i;
          break;
        }
      }
    }
  }
  return events;
}

/**
 * Cheap, zero-RPC-call check: did the transaction that produced these logs
 * invoke a matching instruction (by name pattern) specifically within one
 * of the given programs' own invoke frame? Anchor programs log
 * "Program log: Instruction: <Name>" as the first thing inside their own
 * instruction handler, right after their own "invoke" line - so this needs
 * no transaction fetch or Borsh decoding, only the `logs` array
 * logsSubscribe already delivers for free.
 *
 * Deliberately scoped to the CURRENT top-of-stack program (via the same
 * invoke/success walk extractProgramDataEvents uses above), not just "does
 * this instruction name appear anywhere in the logs" - a composite/bundled
 * transaction can invoke several programs, and an unrelated program
 * elsewhere in the same transaction could coincidentally log a
 * similarly-named instruction.
 *
 * Used by src/tracker.js as a pre-filter before calling getTransaction: a
 * transaction that invokes a tracked program (e.g. pump.fun) for a
 * non-trade instruction (fee distribution, migration, admin actions, ...)
 * is filtered out here without ever fetching or decoding the full
 * transaction - only ones with a real match proceed.
 *
 * @param {string[]} logMessages
 * @param {Set<string>} programIds - program IDs whose own instructions count
 * @param {RegExp} [namePattern] - matched against the instruction name (e.g. "Buy", "SellV2")
 */
export function hasMatchingInstruction(logMessages, programIds, namePattern = /^(Buy|Sell)/) {
  const stack = [];
  for (const line of logMessages || []) {
    const invoke = line.match(INVOKE_RE);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    const ix = line.match(INSTRUCTION_RE);
    if (ix) {
      const currentProgram = stack[stack.length - 1];
      if (currentProgram && programIds.has(currentProgram) && namePattern.test(ix[1])) return true;
      continue;
    }
    const end = line.match(END_RE);
    if (end) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === end[1]) {
          stack.length = i;
          break;
        }
      }
    }
  }
  return false;
}
