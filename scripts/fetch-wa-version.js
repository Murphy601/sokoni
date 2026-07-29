#!/usr/bin/env node
// Prints the latest WhatsApp Web version (e.g. "2.3000.1234567890") to stdout.
// Prints nothing and exits 1 on failure, so WAHA falls back to its built-in version.
// Source: https://waha.devlike.pro/docs/engines/noweb/#configuration (WAHA 2026.7.2+)
const HEADERS = {
  "sec-fetch-site": "none",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

async function main() {
  const response = await fetch("https://web.whatsapp.com/sw.js", {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = await response.text();
  const match = text.match(/\\?"client_revision\\?":\s*(\d+)/);
  if (!match) {
    throw new Error("client_revision not found in sw.js");
  }
  console.log(`2.3000.${match[1]}`);
}

main().catch((err) => {
  console.error(`Could not fetch the latest WhatsApp Web version: ${err}`);
  process.exit(1);
});
