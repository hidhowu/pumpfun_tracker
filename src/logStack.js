const INVOKE_RE = /^Program (\w+) invoke \[(\d+)]$/;
const END_RE = /^Program (\w+) (success|failed.*)$/;
const DATA_RE = /^Program data: (.+)$/;
const RETURN_RE = /^Program return: (\w+) (.+)$/;

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
