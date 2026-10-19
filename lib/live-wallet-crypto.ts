/**
 * Browser half of the one-time private-key hand-off (server half: db/live/walletKeys.js's encryptForClient).
 *
 * Before asking the server to create a wallet, the browser makes a throwaway ECDH P-256 key pair. Its private half is a
 * non-extractable WebCrypto key that never leaves this tab's memory; only the public half is sent. The server answers
 * with the wallet's private key encrypted under a key only the two throwaway halves can derive, so a copy of the
 * HTTP response (proxy logs, a network tap, a browser extension reading responses) is unreadable.
 */

const TRANSPORT_INFO = "pft-live-wallet-transport-v1";

export type EncryptedKeyPayload = { serverPublicKey: string; salt: string; iv: string; ciphertext: string };

export type KeyHandoff = {
  /** Send to the server with the create request. */
  clientPublicKey: string;
  /** Turns the server's payload into the private key text. Works once per hand-off. */
  decrypt: (payload: EncryptedKeyPayload, address: string) => Promise<string>;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function startKeyHandoff(): Promise<KeyHandoff> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("This browser can't do the secure key hand-off - open the app over HTTPS (or localhost).");
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const clientPublicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));

  let used = false;
  return {
    clientPublicKey,
    async decrypt(payload, address) {
      if (used) throw new Error("This key hand-off was already used");
      used = true;
      const serverKey = await crypto.subtle.importKey("raw", fromBase64Url(payload.serverPublicKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
      const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: serverKey }, pair.privateKey, 256);
      const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
      const aes = await crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: fromBase64Url(payload.salt), info: new TextEncoder().encode(TRANSPORT_INFO) },
        hkdf,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
      );
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64Url(payload.iv), additionalData: new TextEncoder().encode(address) },
        aes,
        fromBase64Url(payload.ciphertext)
      );
      return new TextDecoder().decode(plain);
    },
  };
}
