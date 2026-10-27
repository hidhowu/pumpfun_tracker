import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IMPERSONATE_BIN = "curl_chrome116";
const PLAIN_BIN = "curl";

let impersonateAvailable = null; // Promise<boolean>, resolved once per process

/**
 * Whether `curl_chrome116` (curl-impersonate's Chrome 116 wrapper) is installed on this server. Checked once and cached: servers
 * that have it get a real Chrome TLS/HTTP2 fingerprint (what Cloudflare in front of pump.fun looks at), servers that don't - e.g.
 * a Windows dev machine - quietly use plain curl. Restart the app after installing it.
 */
function hasImpersonate() {
  impersonateAvailable ??= execFileAsync(IMPERSONATE_BIN, ["--version"], { timeout: 5000 }).then(
    () => true,
    () => false
  );
  return impersonateAvailable;
}

/**
 * Run curl with `args`: curl_chrome116 where the server has it, plain curl where it doesn't. Same result shape as execFile's promise
 * ({ stdout, stderr }), and it throws like execFile does.
 *
 * `fallbackUserAgent` is only sent to plain curl. curl_chrome116 brings its own Chrome 116 User-Agent and headers to match its
 * Chrome fingerprint, so a random Firefox/Safari string on top of it would be a mismatch.
 */
export async function execCurl(args, { fallbackUserAgent, ...execOptions } = {}) {
  if (await hasImpersonate()) {
    try {
      return await execFileAsync(IMPERSONATE_BIN, args, execOptions);
    } catch (err) {
      if (err.code !== "ENOENT") throw err; // binary vanished since the check - fall through to plain curl
      impersonateAvailable = Promise.resolve(false);
    }
  }
  const plainArgs = fallbackUserAgent ? ["-A", fallbackUserAgent, ...args] : args;
  return execFileAsync(PLAIN_BIN, plainArgs, execOptions);
}
