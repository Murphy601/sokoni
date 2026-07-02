import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib -> sync -> scripts -> repo root
const ROOT = path.resolve(__dirname, "..", "..", "..");

export const FILES = {
  website: path.join(ROOT, "website", "data", "products.json"),
  bot: path.join(ROOT, "whatsapp-bot", "src", "data", "products.json"),
};

// Price fields are only ever *updated*, never *created*, so we don't accidentally
// add a KES price to a USD-only international item (or vice versa).
const PRICE_KEYS = new Set(["priceKes", "priceUsd", "originalPriceKes"]);

export function normalizeSource(source) {
  return String(source || "").toLowerCase();
}

export async function loadCatalogs() {
  const website = JSON.parse(await readFile(FILES.website, "utf-8"));
  const bot = JSON.parse(await readFile(FILES.bot, "utf-8"));
  return { website, bot };
}

/**
 * Both catalog files share product `id`s but have slightly different shapes.
 * This merges them into one index keyed by id, carrying whatever identifiers
 * each provider needs to look a product up (source, sourceUrl, asin, externalId).
 */
export function buildIndex({ website, bot }) {
  const byId = new Map();
  const add = (list) => {
    for (const p of list) {
      const existing = byId.get(p.id) || { id: p.id };
      existing.source = existing.source || normalizeSource(p.source);
      existing.sourceUrl = existing.sourceUrl || p.sourceUrl;
      existing.asin = existing.asin || p.asin;
      existing.externalId = existing.externalId || p.externalId;
      existing.scope = existing.scope || p.scope;
      byId.set(p.id, existing);
    }
  };
  add(website);
  add(bot);
  return byId;
}

/**
 * Applies an update object to every entry matching `id` in a product list.
 * Returns true if anything actually changed. Price fields are only written if
 * the key already exists on the item.
 */
export function applyUpdate(list, id, update) {
  let changed = false;
  for (const p of list) {
    if (p.id !== id) continue;
    for (const [key, value] of Object.entries(update)) {
      if (value === undefined || value === null) continue;
      if (PRICE_KEYS.has(key) && !(key in p)) continue;
      if (p[key] !== value) {
        p[key] = value;
        changed = true;
      }
    }
  }
  return changed;
}

export async function saveCatalogs({ website, bot }) {
  await writeFile(FILES.website, JSON.stringify(website, null, 2) + "\n");
  await writeFile(FILES.bot, JSON.stringify(bot, null, 2) + "\n");
}
