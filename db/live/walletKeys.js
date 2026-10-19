import crypto from "node:crypto";

/**
 * Live-wallet key handling: generating a Solana keypair, keeping its private key encrypted at rest, and handing it to
 * the browser once, encrypted in transit. Only Node's own crypto is used.
 *
 * AT REST - AES-256-GCM (authenticated encryption). The 256-bit key is derived from WALLET_ENCRYPTION_KEY with HKDF-SHA256,
 * every key gets its own random 96-bit IV, and the wallet's address is bound in as additional authenticated data, so a
 * stored secret cannot be copied onto another wallet's record or edited without decryption failing. AES-GCM is hardware
 * accelerated: decrypting takes microseconds, so a trading loop can use the key on every trade with no measurable delay.
 * A database copy alone is useless without WALLET_ENCRYPTION_KEY.
 *
 * IN TRANSIT - on top of HTTPS: the browser makes a throwaway ECDH P-256 key pair and sends only its public half; the
 * server makes its own throwaway pair, derives a shared AES-256-GCM key (ECDH + HKDF-SHA256) and returns the private key
 * encrypted under it. Both private halves are discarded afterwards, so someone who records the traffic (or the
 * reverse-proxy logs) later cannot decrypt it.
 */

const STORE_INFO = "pft-live-wallet-secret-v1";
const TRANSPORT_INFO = "pft-live-wallet-transport-v1";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// ---------------------------------------------------------------- base58

export function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58[digits[i]];
  return out;
}

/** @returns {Buffer} the bytes of a base58 string; throws on a character outside the alphabet */
export function base58Decode(text) {
  const input = String(text);
  let zeros = 0;
  while (zeros < input.length && input[zeros] === "1") zeros += 1;
  const bytes = [];
  for (let i = zeros; i < input.length; i += 1) {
    const value = BASE58.indexOf(input[i]);
    if (value < 0) throw new Error("Invalid base58 text");
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return Buffer.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

// ------------------------------------------------------------ generation

/**
 * A fresh Solana keypair. `secretKey` is the base58 of the 64 bytes (32-byte seed + 32-byte public key) - the format
 * Phantom and Solflare accept under "Import private key".
 */
export function generateSolanaKeypair() {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  const seed = Buffer.from(jwk.d, "base64url");
  const publicKey = Buffer.from(jwk.x, "base64url");
  const secretBytes = Buffer.concat([seed, publicKey]);
  const result = { address: base58Encode(publicKey), secretKey: base58Encode(secretBytes) };
  seed.fill(0);
  secretBytes.fill(0);
  return result;
}

// --------------------------------------------------------------- at rest

function storeKey() {
  const raw = process.env.WALLET_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) return null;
  return Buffer.from(crypto.hkdfSync("sha256", raw, "", STORE_INFO, 32));
}

export function isWalletEncryptionConfigured() {
  return storeKey() !== null;
}

const NOT_CONFIGURED = "WALLET_ENCRYPTION_KEY is not set (at least 32 characters) - see .env.example";

/** Format: v1.<iv>.<tag>.<ciphertext> (base64url). `address` is authenticated but not secret. */
export function encryptWalletSecret(address, secretKey) {
  const key = storeKey();
  if (!key) throw new Error(NOT_CONFIGURED);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(address, "utf8"));
  const enc = Buffer.concat([cipher.update(secretKey, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

/** Server-side only (the trading code that signs transactions). Nothing exposes this over HTTP. */
export function decryptWalletSecret(address, stored) {
  const key = storeKey();
  if (!key) throw new Error(NOT_CONFIGURED);
  const [version, iv, tag, enc] = String(stored).split(".");
  if (version !== "v1" || !iv || !tag || !enc) throw new Error("Unreadable wallet secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(address, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
}

// ------------------------------------------------------------- in transit

/** True if `value` is a base64url uncompressed P-256 public key (65 bytes starting 0x04). */
export function parseClientPublicKey(value) {
  if (typeof value !== "string" || value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const raw = Buffer.from(value, "base64url");
  return raw.length === 65 && raw[0] === 4 ? raw : null;
}

/**
 * Encrypts `secretKey` for the browser that sent `clientPublicKeyRaw`. The address is the AAD, so the browser can tell
 * the key really is for the wallet being shown. Throws if the public key is not a valid P-256 point.
 */
export function encryptForClient(clientPublicKeyRaw, address, secretKey) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const shared = ecdh.computeSecret(clientPublicKeyRaw); // rejects points that are not on the curve
  const salt = crypto.randomBytes(16);
  const key = Buffer.from(crypto.hkdfSync("sha256", shared, salt, TRANSPORT_INFO, 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(address, "utf8"));
  const enc = Buffer.concat([cipher.update(secretKey, "utf8"), cipher.final()]);
  const payload = {
    serverPublicKey: ecdh.getPublicKey().toString("base64url"),
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    // WebCrypto's AES-GCM expects the 16-byte tag appended to the ciphertext.
    ciphertext: Buffer.concat([enc, cipher.getAuthTag()]).toString("base64url"),
  };
  shared.fill(0);
  key.fill(0);
  return payload;
}
