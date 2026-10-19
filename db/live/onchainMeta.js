import dns from "node:dns/promises";
import net from "node:net";
import { PublicKey } from "@solana/web3.js";
import { rpc } from "../onchainPrice.js";

/**
 * A token's name, symbol and logo straight from the chain - what wallets like Solflare and the Telegram bots show.
 * Two places hold it:
 *  - Token-2022 mints can carry it inside the mint account itself (the "tokenMetadata" extension);
 *  - everything else (including every pump.fun token) has a Metaplex metadata account at a fixed address derived from the mint.
 * Both give a name, a symbol and a `uri` pointing at a small JSON file that holds the image link; that file is fetched
 * with the safeguards in `fetchJson` below.
 */

const METAPLEX_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const MAX_JSON_BYTES = 100_000;

const clean = (text) => (typeof text === "string" ? text.replace(/\0/g, "").trim() : "");

/** ipfs:// and ar:// links become plain https links; anything else must already be https. */
function toHttps(uri) {
  const link = clean(uri);
  if (link.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${link.slice(7).replace(/^ipfs\//, "")}`;
  if (link.startsWith("ar://")) return `https://arweave.net/${link.slice(5)}`;
  return link.startsWith("https://") ? link : null;
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

const MAX_REDIRECTS = 3;

/** A link is only followed if it is https, names a real host (not an IP, localhost or an internal name) and that host resolves to public addresses. */
async function isSafeUrl(url) {
  if (url.protocol !== "https:" || net.isIP(url.hostname) !== 0 || url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) return false;
  try {
    const addresses = await dns.lookup(url.hostname, { all: true });
    return addresses.length > 0 && !addresses.some((a) => isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/**
 * The metadata link is written by whoever created the token, so it is untrusted: every hop (the link itself and each
 * redirect - IPFS gateways always redirect) must pass isSafeUrl, responses are small, and the wait is short. Only the
 * text fields of the JSON are ever used.
 */
async function fetchJson(uri) {
  const link = toHttps(uri);
  if (!link) return null;
  try {
    let url = new URL(link);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isSafeUrl(url))) return null;
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(6000), headers: { accept: "application/json" } });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) return null;
        url = new URL(next, url);
        continue;
      }
      if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_JSON_BYTES) return null;
      const text = await res.text();
      return text.length > MAX_JSON_BYTES ? null : JSON.parse(text);
    }
  } catch {
    return null;
  }
  return null;
}

/** Metaplex's account layout: key, update authority, mint, then name / symbol / uri as length-prefixed (padded) strings. */
function parseMetaplex(buffer) {
  let offset = 65;
  const readString = () => {
    const length = buffer.readUInt32LE(offset);
    const text = buffer.subarray(offset + 4, offset + 4 + length).toString("utf8");
    offset += 4 + length;
    return clean(text);
  };
  return { name: readString(), symbol: readString(), uri: readString() };
}

async function readOnchain(mint) {
  const mintAccount = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const extensions = mintAccount?.value?.data?.parsed?.info?.extensions;
  const embedded = Array.isArray(extensions) ? extensions.find((e) => e.extension === "tokenMetadata")?.state : null;
  if (embedded) return { name: clean(embedded.name), symbol: clean(embedded.symbol), uri: clean(embedded.uri) };

  const [address] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()], METAPLEX_PROGRAM);
  const account = await rpc("getAccountInfo", [address.toBase58(), { encoding: "base64", commitment: "confirmed" }]);
  const data = account?.value?.data?.[0];
  return data ? parseMetaplex(Buffer.from(data, "base64")) : null;
}

/** @returns {Promise<{ name: string|null, symbol: string|null, icon: string|null } | null>} null when the token has no on-chain metadata */
export async function getOnchainTokenMeta(mint) {
  const found = await readOnchain(mint).catch(() => null);
  if (!found || (!found.name && !found.symbol)) return null;
  const json = found.uri ? await fetchJson(found.uri) : null;
  const image = typeof json?.image === "string" ? toHttps(json.image) : null;
  return { name: found.name || clean(json?.name) || null, symbol: found.symbol || clean(json?.symbol) || null, icon: image };
}
