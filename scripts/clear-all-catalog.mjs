#!/usr/bin/env node
/**
 * Wipe all products from Postgres + master JSON. Storefront stays hidden via catalog-paused.json.
 *
 *   node scripts/clear-all-catalog.mjs
 *   node scripts/clear-all-catalog.mjs --dry-run
 */
import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MASTER = path.join(ROOT, "whatsapp-bot", "src", "data", "products.json");
const PAUSE_FILE = path.join(ROOT, "website", "data", "catalog-paused.json");
const BOT_ENV = path.join(ROOT, "whatsapp-bot", ".env");

const dryRun = process.argv.includes("--dry-run");

async function loadEnv() {
  try {
    const content = await readFile(BOT_ENV, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

await loadEnv();

const pausePayload = {
  paused: true,
  reason: "Catalog wiped for Depop redesign — no products public until re-listed.",
  pausedAt: new Date().toISOString(),
  wiped: true,
};

let masterCount = 0;
try {
  const master = JSON.parse(await readFile(MASTER, "utf-8"));
  masterCount = Array.isArray(master) ? master.length : 0;
} catch {
  masterCount = 0;
}

console.log(`Master JSON products: ${masterCount}`);
console.log(`Dry run: ${dryRun}`);

if (dryRun) {
  console.log("Would: set catalog-paused, empty products.json, DELETE FROM products, rebuild site catalog");
  process.exit(0);
}

if (masterCount > 0) {
  const backup = `${MASTER}.bak-${Date.now()}`;
  await copyFile(MASTER, backup);
  console.log(`Backup: ${backup}`);
}

await writeFile(MASTER, "[]\n", "utf-8");
await writeFile(PAUSE_FILE, JSON.stringify(pausePayload, null, 2) + "\n", "utf-8");
console.log("Wrote [] → products.json");
console.log("Updated catalog-paused.json");

const dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  const pool = new pg.Pool({ connectionString: dbUrl });
  try {
    const { rows: before } = await pool.query("SELECT COUNT(*)::int AS n FROM products");
    await pool.query("DELETE FROM products");
    const { rows: after } = await pool.query("SELECT COUNT(*)::int AS n FROM products");
    console.log(`PostgreSQL: deleted ${before[0]?.n || 0} products (${after[0]?.n || 0} remaining)`);
  } finally {
    await pool.end();
  }
} else {
  console.log("DATABASE_URL not set — skipped Postgres wipe");
}

const { spawn } = await import("node:child_process");
await new Promise((resolve, reject) => {
  const child = spawn("node", ["scripts/build-site-catalog.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build-site-catalog exit ${code}`))));
});

console.log("\nDone. Restart the bot:");
console.log("  bash scripts/deploy-bot.sh");
console.log("\nShoppers will see an empty catalog on WhatsApp, API, and website until you re-list items.");
