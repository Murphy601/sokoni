/**
 * When catalog-paused.json is set, the public catalog is empty everywhere
 * (website, API, WhatsApp browse) — master data may still exist for admin backup only.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAUSE_FILE = path.join(__dirname, "..", "..", "..", "website", "data", "catalog-paused.json");

let cachedPause = null;
let cachedPauseAt = 0;
const CACHE_MS = 5000;

export async function getCatalogPauseState() {
  const now = Date.now();
  if (cachedPause != null && now - cachedPauseAt < CACHE_MS) {
    return cachedPause;
  }
  try {
    const raw = await readFile(PAUSE_FILE, "utf-8");
    cachedPause = JSON.parse(raw);
  } catch {
    cachedPause = { paused: false };
  }
  cachedPauseAt = now;
  return cachedPause;
}

/** True = no products on site, API, or WhatsApp shopper menus. */
export async function isCatalogPubliclyDisabled() {
  const state = await getCatalogPauseState();
  return state?.paused === true;
}

export function clearCatalogPauseCache() {
  cachedPause = null;
  cachedPauseAt = 0;
}
