/**
 * Load Depop-style browse menu (shared with website/data/browse-menu.json).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROWSE_MENU_PATH = path.join(__dirname, "..", "..", "..", "website", "data", "browse-menu.json");

const PRICE_TIER_MAX = {
  "under-1000": 1000,
  "under-2500": 2500,
  "under-5000": 5000,
  "under-10000": 10000,
};

/** @type {Record<string, unknown> | null} */
let cachedMenu = null;

export async function loadBrowseMenuData() {
  if (cachedMenu) return cachedMenu;
  const raw = await readFile(BROWSE_MENU_PATH, "utf-8");
  cachedMenu = JSON.parse(raw);
  return cachedMenu;
}

export function resolveBrowsePath(product, legacyMap) {
  if (!product) return { browse: "trending", sub: "streetwear" };
  if (product.browseCategory) {
    return {
      browse: product.browseCategory,
      sub: product.browseSubCategory || null,
    };
  }
  const map = legacyMap || cachedMenu?.legacyMap || {};
  const full = product.subcategory
    ? `${product.category}/${product.subcategory}`
    : product.category;
  return map[full] || map[product.category] || { browse: "trending", sub: "streetwear" };
}

/**
 * Build WhatsApp numbered-menu structure from browse taxonomy.
 * @returns {Promise<Record<string, { browseCategory: string, label: string, rows: Array<{ id: string, title: string, browseSubCategory?: string, priceTier?: string, legacyCategory?: string, legacySubcategory?: string }> }>>}
 */
export async function buildBrowseSubmenus() {
  const menu = await loadBrowseMenuData();
  /** @type {Record<string, unknown>} */
  const submenus = {};

  for (const cat of menu.categories || []) {
    const menuId = `browse_${cat.id}`;
    const rows = (cat.subcategories || []).map((sub) => ({
      id: `sub_${cat.id}_${sub.id}`,
      title: sub.label,
      browseSubCategory: sub.id,
      priceTier: sub.priceTier || null,
    }));

    if (cat.id === "women") {
      rows.push({
        id: "sub_women_perfume-oils",
        title: "Perfume Oils",
        legacyCategory: "health-beauty",
        legacySubcategory: "perfume-oils",
      });
    }

    submenus[menuId] = {
      browseCategory: cat.id,
      label: `${cat.emoji || "🛍️"} ${cat.label}`,
      rows,
    };
  }

  return submenus;
}

export function priceTierMaxKes(tierId) {
  if (!tierId) return null;
  const fromMenu = cachedMenu?.priceTiers?.find((t) => t.id === tierId);
  if (fromMenu?.maxKes != null) return fromMenu.maxKes;
  return PRICE_TIER_MAX[tierId] ?? null;
}

export { PRICE_TIER_MAX };
