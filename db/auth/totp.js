import crypto from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238) - the 6-digit codes Google Authenticator, Authy, 1Password etc. show. Built on
 * Node's own crypto, so no OTP library is involved in the login path. SHA-1, 6 digits and 30 s are the parameters every
 * authenticator app supports.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh 160-bit secret, base32 (what the user types or scans into the app). */
export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * The time step `code` is valid for (allowing one step either side for clock drift), or null. Every candidate step is
 * compared in constant time and none exits early, so timing says nothing about how close a guess was. The caller must
 * remember the returned step and refuse it (and anything older) afterwards - that is what stops a code being replayed.
 */
export function verifyTotp(secretBase32, code, { now = Date.now(), window = 1 } = {}) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(now);
  const given = Buffer.from(code);
  let matched = null;
  for (let w = -window; w <= window; w += 1) {
    const expected = Buffer.from(hotp(secret, current + w));
    if (crypto.timingSafeEqual(expected, given)) matched = current + w;
  }
  return matched;
}

/** The otpauth:// link authenticator apps import (what the QR code encodes). */
export function otpauthUrl({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ------------------------------------------------------------ secrets at rest

function encryptionKey() {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) return null;
  return Buffer.from(crypto.hkdfSync("sha256", raw, "", "pft-totp-secret-v1", 32));
}

export function isTotpEncryptionConfigured() {
  return encryptionKey() !== null;
}

/** AES-256-GCM, so a database copy alone can't be used to generate codes. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plain) {
  const key = encryptionKey();
  if (!key) throw new Error("TOTP_ENCRYPTION_KEY is not set (at least 32 characters) - see .env.example");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(stored) {
  const key = encryptionKey();
  if (!key) throw new Error("TOTP_ENCRYPTION_KEY is not set (at least 32 characters) - see .env.example");
  const [version, iv, tag, enc] = String(stored).split(".");
  if (version !== "v1" || !iv || !tag || !enc) throw new Error("Unreadable two-factor secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
}

// ------------------------------------------------------------ recovery codes

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
export const RECOVERY_CODE_COUNT = 10;

/** Ten single-use codes like "K7M2P-9XQ4T" (50 bits each). Returned once in plain text; only hashes are stored. */
export function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = Array.from(crypto.randomBytes(10), (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code) {
  return typeof code === "string" ? code.toUpperCase().replace(/[\s-]/g, "") : "";
}

export function looksLikeRecoveryCode(code) {
  return /^[A-Z2-9]{10}$/.test(normalizeRecoveryCode(code));
}

/** SHA-256 is enough here: the codes are 50 bits of randomness, not human-chosen. */
export function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}
