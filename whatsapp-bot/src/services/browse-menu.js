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
    const catResolve = cat.resolvesTo || null;
    const rows = (cat.subcategories || []).map((sub) => {
      const resolved = sub.resolvesTo || catResolve || null;
      return {
        id: `sub_${cat.id}_${sub.id}`,
        title: sub.label,
        browseSubCategory: resolved?.sub ?? sub.id,
        priceTier: sub.priceTier || null,
        // When nav alias (e.g. Phones → electronics/phones), query the canonical path
        ...(resolved?.browse
          ? { browseCategory: resolved.browse }
          : {}),
      };
    });

    if (cat.id === "women") {
      rows.push({
        id: "sub_women_perfume-oils",
        title: "Perfume Oils",
        legacyCategory: "health-beauty",
        legacySubcategory: "perfume-oils",
      });
    }

    submenus[menuId] = {
      browseCategory: catResolve?.browse || cat.id,
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

/** Compact taxonomy payload for Sokoni Plug (WhatsApp + web Ask). */
export async function browseTaxonomyForAi() {
  const menu = await loadBrowseMenuData();
  const categories = (menu.categories || []).map((cat) => ({
    id: cat.id,
    label: cat.label,
    emoji: cat.emoji || null,
    navOnly: Boolean(cat.navOnly),
    resolvesTo: cat.resolvesTo || null,
    subcategories: (cat.subcategories || []).map((sub) => ({
      id: sub.id,
      label: sub.label,
      resolvesTo: sub.resolvesTo || null,
      priceTier: sub.priceTier || null,
    })),
  }));

  return {
    version: menu.version || null,
    categories,
    itemTypes: menu.itemTypes || [],
    priceTiers: menu.priceTiers || [],
    aesthetics: (menu.aesthetics || []).map((a) => ({
      id: a.id,
      label: a.label,
      match: a.match || [],
    })),
    decades: menu.decades || [],
  };
}

function normalizeMatchKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detect browse category / subcategory mentions in free text.
 * Prefers longer label matches; honors resolvesTo / navOnly aliases.
 */
export async function matchBrowseFromText(text) {
  const menu = await loadBrowseMenuData();
  const hay = ` ${normalizeMatchKey(text)} `;
  if (hay.length < 4) return null;

  /** @type {Array<{ score: number, browseCategory: string, browseSubCategory: string | null, label: string, source: string, aesthetic?: string }>} */
  const hits = [];
  const hasBudgetCue = /\b(under|chini|below|less than)\b/i.test(String(text || ""));
  const hasProductAisleCue =
    /\b(electronics|phones?|laptops?|fashion|women|men|kids?|sneakers?|shoes?|beauty|appliances?|supermarket|garden|tools?)\b/i.test(
      String(text || "")
    );

  for (const cat of menu.categories || []) {
    const resolvedBrowse = cat.resolvesTo?.browse || cat.id;
    const resolvedSubDefault = cat.resolvesTo?.sub ?? null;
    const catKeys = [cat.id, cat.label, ...(cat.aliases || [])]
      .map(normalizeMatchKey)
      .filter((k) => k.length >= 2);

    for (const key of catKeys) {
      if (hay.includes(` ${key} `) || hay.includes(` ${key}s `)) {
        hits.push({
          score: key.length + (cat.navOnly ? 0 : 2),
          browseCategory: resolvedBrowse,
          browseSubCategory: resolvedSubDefault,
          label: cat.label,
          source: "category",
        });
      }
    }

    for (const sub of cat.subcategories || []) {
      const resolved = sub.resolvesTo || cat.resolvesTo || null;
      const browse = resolved?.browse || cat.id;
      const subId = resolved?.sub ?? sub.id;
      const subKeys = [sub.id, sub.label, `${cat.label} ${sub.label}`]
        .map(normalizeMatchKey)
        .filter((k) => k.length >= 2);
      const isPriceTierSub =
        browse === "sale" ||
        /^under[- ]?\d+/.test(String(subId || "")) ||
        /under kes|under ksh/i.test(String(sub.label || ""));
      for (const key of subKeys) {
        if (hay.includes(` ${key} `) || hay.includes(` ${key}s `)) {
          let score = key.length + 8;
          // "Electronics under 10000" must prefer Electronics, not Sale → Under 10k.
          if (isPriceTierSub && hasBudgetCue && hasProductAisleCue) score -= 30;
          hits.push({
            score,
            browseCategory: browse,
            browseSubCategory: subId,
            label: `${cat.label} → ${sub.label}`,
            source: "subcategory",
          });
        }
      }
    }
  }

  // Aesthetic / vibe tags (Y2K, streetwear…)
  for (const vibe of menu.aesthetics || []) {
    const keys = [vibe.id, vibe.label, ...(vibe.match || [])].map(normalizeMatchKey).filter(Boolean);
    for (const key of keys) {
      if (key.length >= 2 && (hay.includes(` ${key} `) || hay.includes(`#${key}`))) {
        hits.push({
          score: key.length + 4,
          browseCategory: "trending",
          browseSubCategory: null,
          label: `#${vibe.label}`,
          source: "aesthetic",
          aesthetic: vibe.id,
        });
      }
    }
  }

  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score);
  return hits[0];
}

export { PRICE_TIER_MAX };
