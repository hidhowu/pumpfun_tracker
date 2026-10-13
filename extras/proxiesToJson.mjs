// Turns a text file of proxies, one per line as  host:port:username:password , into a JSON array:
//   [ { "host": "...", "port": 1234, "username": "...", "password": "..." }, ... ]
//
// Usage:  node extras/proxiesToJson.mjs <proxies.txt> [output.json]
// Without an output file the JSON is written next to the input as <name>.json.
// Blank lines are ignored; a line that does not look like a proxy is skipped and reported. A password may contain ":".
import fs from "node:fs";
import path from "node:path";

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node extras/proxiesToJson.mjs <proxies.txt> [output.json]");
  process.exit(1);
}

const lines = fs.readFileSync(input, "utf8").split(/\r?\n/);
const proxies = [];
const skipped = [];

lines.forEach((raw, i) => {
  const line = raw.trim();
  if (!line) return;
  const [host, port, username, ...rest] = line.split(":");
  const password = rest.join(":");
  const portNumber = Number(port);
  if (!host || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535 || !username || !password) {
    skipped.push(`line ${i + 1}: ${line}`);
    return;
  }
  proxies.push({ host, port: portNumber, username, password });
});

const target = output ?? path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.json`);
fs.writeFileSync(target, JSON.stringify(proxies, null, 2) + "\n");

console.log(`${proxies.length} proxies written to ${target}`);
if (skipped.length > 0) {
  console.warn(`${skipped.length} line(s) skipped (expected host:port:username:password):`);
  for (const s of skipped) console.warn(`  ${s}`);
}
