#!/usr/bin/env node
/** Preflight: load critical bot modules (catches bad imports before pm2 start). */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const botDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "whatsapp-bot");

const modules = [
  "src/services/catalog-ops.js",
  "src/services/seller-onboard.js",
  "src/services/seller-verification.js",
  "src/routes/sellerOnboardApi.js",
];

for (const rel of modules) {
  const file = path.join(botDir, rel);
  try {
    await import(pathToFileURL(file).href);
    console.log(`[verify-bot] OK ${rel}`);
  } catch (err) {
    console.error(`[verify-bot] FAILED ${rel}:`, err.message);
    process.exit(1);
  }
}

console.log("[verify-bot] All critical modules loaded");
