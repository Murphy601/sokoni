#!/usr/bin/env node
/**
 * Wipe all products from Postgres + master JSON.
 *
 *   cd whatsapp-bot && npm run catalog:clear
 *   node scripts/clear-all-catalog.mjs --dry-run
 */
import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { query, closePool, isDbEnabled } from "../src/db/pool.js";
import { invalidateProductCache } from "../src/services/catalog.js";
import { clearCatalogPauseCache } from "../src/services/catalog-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const MASTER = path.join(ROOT, "whatsapp-bot", "src", "data", "products.json");
const PAUSE_FILE = path.join(ROOT, "website", "data", "catalog-paused.json");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const dryRun = process.argv.includes("--dry-run");

const pausePayload = {
  paused: true,
  reason: "Catalog wiped for Depop redesign — no products public until re-listed.",
  pausedAt: new Date().toISOString(),
  wiped: true,
};

async function main() {
  let masterCount = 0;
  try {
    const master = JSON.parse(await readFile(MASTER, "utf-8"));
    masterCount = Array.isArray(master) ? master.length : 0;
  } catch {
    masterCount = 0;
  }

  let dbCount = 0;
  if (isDbEnabled()) {
    const { rows } = await query("SELECT COUNT(*)::int AS n FROM products");
    dbCount = rows[0]?.n || 0;
  }

  console.log(`Master JSON products: ${masterCount}`);
  console.log(`PostgreSQL products: ${dbCount}`);
  console.log(`Dry run: ${dryRun}`);

  if (dryRun) {
    console.log("Would: pause catalog, empty products.json, DELETE FROM products, rebuild site catalog");
    return;
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

  if (isDbEnabled()) {
    const { rows: before } = await query("SELECT COUNT(*)::int AS n FROM products");
    await query("DELETE FROM products");
    const { rows: after } = await query("SELECT COUNT(*)::int AS n FROM products");
    console.log(`PostgreSQL: deleted ${before[0]?.n || 0} products (${after[0]?.n || 0} remaining)`);
  } else {
    console.log("DATABASE_URL not set — skipped Postgres wipe");
  }

  invalidateProductCache();
  clearCatalogPauseCache();

  await new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/build-site-catalog.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`build-site-catalog exit ${code}`))
    );
  });

  console.log("\nDone. Restart the bot:");
  console.log("  bash scripts/deploy-bot.sh");
}

main()
  .catch((err) => {
    console.error("[catalog:clear] failed:", err.message);
    process.exit(1);
  })
  .finally(() => closePool());
