/**
 * Phase 9 — Catalog pause/live, sync, stock, migration helpers.
 * Note: mkdirSync/existsSync come from node:fs (not fs/promises).
 */
import { readFile, writeFile } from "node:fs/promises";
import { mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { clearCatalogPauseCache, getCatalogPauseState, isCatalogPubliclyDisabled } from "./catalog-guard.js";
import { invalidateProductCache } from "./catalog.js";
import { getPlatformFlags, updatePlatformFlags } from "./platform-flags.js";
import { isDbEnabled, pingDb } from "../db/pool.js";
import { refreshFeedCache } from "./feed-ranking.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MASTER_PRODUCTS = path.join(__dirname, "..", "data", "products.json");
const WEBSITE_PRODUCTS = path.join(REPO_ROOT, "website", "data", "products.json");
const PAUSE_FILE = path.join(REPO_ROOT, "website", "data", "catalog-paused.json");

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export async function getOpsStatus() {
  const pause = await getCatalogPauseState();
  const flags = getPlatformFlags();
  const db = await pingDb();
  const master = await readJson(MASTER_PRODUCTS, []);
  const publicCatalog = await readJson(WEBSITE_PRODUCTS, []);

  return {
    phase: 9,
    catalog: {
      paused: pause?.paused === true,
      reason: pause?.reason || null,
      masterCount: Array.isArray(master) ? master.length : 0,
      publicCount: Array.isArray(publicCatalog) ? publicCatalog.length : 0,
      publiclyDisabled: await isCatalogPubliclyDisabled(),
    },
    flags,
    database: {
      enabled: isDbEnabled(),
      connected: db.ok,
      error: db.ok ? null : db.reason,
    },
    prepaidOnly: flags.prepaidOnly,
    maintenanceMode: flags.maintenanceMode,
  };
}

export async function pauseCatalog(reason = "Paused by admin") {
  await writeJson(PAUSE_FILE, {
    paused: true,
    reason: String(reason).slice(0, 300),
    pausedAt: new Date().toISOString(),
  });
  clearCatalogPauseCache();
  invalidateProductCache();
  return getOpsStatus();
}

export async function unpauseCatalog(note = "Catalog live") {
  const prev = await readJson(PAUSE_FILE, {});
  await writeJson(PAUSE_FILE, {
    paused: false,
    reason: note,
    pausedAt: prev.pausedAt || null,
    liveAt: new Date().toISOString(),
  });
  clearCatalogPauseCache();
  invalidateProductCache();
  return getOpsStatus();
}

/** Rebuild website/data/products.json from master (no git push). */
export async function syncPublicCatalog() {
  const script = path.join(REPO_ROOT, "scripts", "build-site-catalog.mjs");
  if (!existsSync(script)) {
    throw new Error("build-site-catalog.mjs not found");
  }
  execSync(`node "${script}"`, { cwd: REPO_ROOT, encoding: "utf-8", stdio: "pipe" });
  clearCatalogPauseCache();
  invalidateProductCache();
  try {
    await refreshFeedCache();
  } catch (err) {
    console.warn("[catalog-ops] feed refresh:", err.message);
  }
  return getOpsStatus();
}

/** Full publish: build + git commit/push (VM only). */
export async function publishCatalogToGit() {
  const script = path.join(REPO_ROOT, "scripts", "publish-catalog-now.mjs");
  if (!existsSync(script)) throw new Error("publish-catalog-now.mjs not found");
  execSync(`node "${script}"`, { cwd: REPO_ROOT, encoding: "utf-8", stdio: "inherit" });
  return getOpsStatus();
}

export async function setProductStock(productId, inStock) {
  if (!productId) return { error: "missing_product_id" };
  const id = String(productId).trim();
  const paths = [MASTER_PRODUCTS, WEBSITE_PRODUCTS];
  let updated = false;

  for (const file of paths) {
    if (!existsSync(file)) continue;
    const products = await readJson(file, []);
    if (!Array.isArray(products)) continue;
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) continue;
    products[idx] = { ...products[idx], inStock: Boolean(inStock) };
    await writeJson(file, products);
    updated = true;
  }

  if (!updated) return { error: "product_not_found", productId: id };

  invalidateProductCache();
  clearCatalogPauseCache();
  return { ok: true, productId: id, inStock: Boolean(inStock) };
}

export async function runDbMigrate() {
  if (!isDbEnabled()) return { error: "database_disabled" };
  execSync("npm run db:migrate", {
    cwd: path.join(REPO_ROOT, "whatsapp-bot"),
    encoding: "utf-8",
    stdio: "pipe",
  });
  return { ok: true, action: "db:migrate" };
}

export async function runDbSeed(dryRun = false) {
  if (!isDbEnabled()) return { error: "database_disabled" };
  const botDir = path.join(REPO_ROOT, "whatsapp-bot");
  const args = dryRun ? " --dry-run" : "";
  execSync(`node scripts/migrate-catalog-to-db.mjs${args}`, {
    cwd: botDir,
    encoding: "utf-8",
    stdio: "pipe",
  });
  invalidateProductCache();
  return { ok: true, action: "db:seed", dryRun };
}

export { updatePlatformFlags, getPlatformFlags };
