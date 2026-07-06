#!/usr/bin/env node
/**
 * Print the one-time TikTok OAuth connect URL.
 * Usage: node scripts/tiktok-connect.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../whatsapp-bot/.env");

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(envPath);

const { config } = await import("../whatsapp-bot/src/config.js");
const { getConnectionStatus } = await import("../whatsapp-bot/src/services/tiktok-auth.js");

const port = config.port || 3001;
const token = config.tiktok.setupToken;
const redirect = config.tiktok.redirectUri;

if (!config.tiktok.clientKey || !config.tiktok.clientSecret) {
  console.error("Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in whatsapp-bot/.env");
  process.exit(1);
}

if (!token) {
  console.error("Set TIKTOK_SETUP_TOKEN in whatsapp-bot/.env (any long random string).");
  process.exit(1);
}

const status = getConnectionStatus();
const connectUrl = `http://localhost:${port}/admin/tiktok/connect?token=${encodeURIComponent(token)}`;

console.log("\n=== Sokoni TikTok OAuth ===\n");
console.log("1. Register this redirect URI in TikTok Developer Portal (Login Kit):");
console.log(`   ${redirect}\n`);
console.log("2. Start the bot:  cd whatsapp-bot && npm start\n");
console.log("3. Open this URL in your browser (one-time connect):\n");
console.log(`   ${connectUrl}\n`);

if (status.connected) {
  console.log("Status: already connected ✅");
  console.log(`  Access valid until: ${status.accessExpiresAt}`);
  console.log(`  Refresh valid until: ${status.refreshExpiresAt}\n`);
} else {
  console.log("Status: not connected yet\n");
}
