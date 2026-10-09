import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

// scrypt (memory-hard, built into Node - no native addon to compile) at one
// of OWASP's recommended equal-strength settings: N=2^15, r=8, p=3. That
// needs 32 MiB per hash rather than the 128 MiB of the N=2^17/p=1 variant,
// which matters here: libuv runs at most 4 hashes at once, so a burst of
// login attempts tops out at ~128 MiB instead of ~512 MiB on the same box
// as the tracker daemon. Parameters are stored in every hash, so they can be
// raised later without invalidating existing passwords.
const PARAMS = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 12;
// Bounds the work an attacker can make us do per attempt (scrypt itself is
// fine with long input, this just keeps request bodies sane).
export const PASSWORD_MAX_LENGTH = 128;

/** "scrypt$N$r$p$salt$hash" (salt/hash base64). */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

/** Constant-time check. Any malformed stored hash simply fails - never throws on bad input. */
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  try {
    const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEM,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Verified against when the username doesn't exist, so an unknown username
// takes the same ~scrypt time as a wrong password and response timing can't
// be used to discover which usernames are real.
let dummyHashPromise = null;
export function getDummyHash() {
  dummyHashPromise ??= hashPassword(crypto.randomBytes(32).toString("hex"));
  return dummyHashPromise;
}

/** Returns a list of problems (empty = acceptable). */
export function checkPasswordStrength(password, username = "") {
  const problems = [];
  if (typeof password !== "string") return ["Password is required."];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > PASSWORD_MAX_LENGTH) problems.push(`Must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) problems.push("Must mix at least 3 of: lowercase, uppercase, digits, symbols.");
  if (username && password.toLowerCase().includes(username.toLowerCase())) problems.push("Must not contain the username.");
  if (/^(.)\1+$/.test(password)) problems.push("Must not be a single repeated character.");
  return problems;
}
