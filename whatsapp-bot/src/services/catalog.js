import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { looksLikeDeliveryDetails } from "./delivery-details.js";
import { normalizeShopperQuery } from "./shopper-language.js";
import { isDbEnabled } from "../db/pool.js";
import { listProducts as listProductsFromDb } from "../db/repositories/products.js";
import { isCatalogPubliclyDisabled } from "./catalog-guard.js";
import { applySoldLocks, isProductAvailable } from "./product-availability.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_PATH = path.join(__dirname, "..", "data", "products.json");

let cachedProducts = null;
let cachedAtMs = 0;
/** Soft TTL so Ask / WhatsApp pick up new listings without waiting for a restart. */
const CATALOG_CACHE_TTL_MS = 10_000;

/** Clear in-memory cache after admin/catalog writes. */
export function invalidateProductCache() {
  cachedProducts = null;
  cachedAtMs = 0;
}

/**
 * Loads the product catalog from PostgreSQL when DATABASE_URL is set,
 * otherwise from the static JSON master file.
 */
async function loadProducts() {
  if (await isCatalogPubliclyDisabled()) {
    return [];
  }
  const now = Date.now();
  if (cachedProducts && now - cachedAtMs < CATALOG_CACHE_TTL_MS) {
    return cachedProducts;
  }
  if (isDbEnabled()) {
    try {
      // Shopper surfaces: live stock only + sold-sku registry locks.
      const rows = await listProductsFromDb({ inStockOnly: true });
      cachedProducts = await applySoldLocks(rows);
      cachedProducts = cachedProducts.filter((p) => isProductAvailable(p));
      try {
        const { blockedShopLookup, isProductFromBlockedShop } = await import(
          "./enforce-account.js"
        );
        const blocked = blockedShopLookup();
        cachedProducts = cachedProducts.filter((p) => !isProductFromBlockedShop(p, blocked));
      } catch {
        /* fail-soft */
      }
      cachedAtMs = now;
      return cachedProducts;
    } catch (err) {
      console.warn("[catalog] DB load failed, falling back to JSON:", err.message);
      cachedProducts = null;
      cachedAtMs = 0;
    }
  }
  const raw = await readFile(PRODUCTS_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  cachedProducts = Array.isArray(parsed) ? await applySoldLocks(parsed) : parsed;
  cachedProducts = Array.isArray(cachedProducts)
    ? cachedProducts.filter((p) => isProductAvailable(p))
    : cachedProducts;
  if (Array.isArray(cachedProducts)) {
    try {
      const { blockedShopLookup, isProductFromBlockedShop } = await import(
        "./enforce-account.js"
      );
      const blocked = blockedShopLookup();
      cachedProducts = cachedProducts.filter((p) => !isProductFromBlockedShop(p, blocked));
    } catch {
      /* fail-soft */
    }
  }
  cachedAtMs = now;
  return cachedProducts;
}

export async function getCategories() {
  const products = await loadProducts();
  const categories = new Map();
  for (const product of products) {
    if (!categories.has(product.category)) {
      categories.set(product.category, new Set());
    }
    categories.get(product.category).add(product.subcategory);
  }
  return Object.fromEntries(
    [...categories.entries()].map(([category, subs]) => [category, [...subs]])
  );
}

/**
 * Simple in-memory search used both by the menu-driven flow and by the
 * AI agent's `search_products` tool call.
 * Hybrid: keyword score + optional pgvector cosine hits when embeddings exist.
 */
export async function searchProducts({
  category,
  subcategory,
  browseCategory,
  browseSubCategory,
  keywords,
  maxPriceKes,
  minPriceKes,
  source,
  scope,
  fulfillment,
  limit = 3,
} = {}) {
  const products = await loadProducts();
  const { loadBrowseMenuData, resolveBrowsePath } = await import("./browse-menu.js");
  const menu = await loadBrowseMenuData();

  const keywordTokens = expandKeywordTokens(keywords);
  const byId = new Map(products.map((p) => [p.id, p]));

  /** @type {Map<string, number>} */
  const vectorBoost = new Map();
  if (keywordTokens.length > 0 && String(keywords || "").trim()) {
    try {
      const { searchProductEmbeddingHits } = await import("./product-embeddings.js");
      const hits = await searchProductEmbeddingHits(String(keywords), {
        limit: Math.max(12, (limit || 3) * 4),
        maxPriceKes,
        minPriceKes,
      });
      for (const h of hits) {
        if (h.score > 0.25) vectorBoost.set(h.id, h.score);
      }
    } catch {
      /* keyword-only fallback */
    }
  }

  let results = products.filter((product) => {
    if (!isProductAvailable(product)) return false;
    if (category && product.category !== category) return false;
    if (subcategory && product.subcategory !== subcategory) return false;
    if (browseCategory || browseSubCategory) {
      const path = resolveBrowsePath(product, menu.legacyMap);
      if (browseCategory && path.browse !== browseCategory) return false;
      if (browseSubCategory && path.sub !== browseSubCategory) return false;
    }
    if (source && product.source !== source) return false;
    if (scope && scope !== "all" && product.scope !== scope) return false;
    if (fulfillment && fulfillment !== "all" && product.fulfillment !== fulfillment) return false;
    if (maxPriceKes != null && product.priceKes != null && product.priceKes > maxPriceKes) {
      return false;
    }
    if (minPriceKes != null && product.priceKes != null && product.priceKes < minPriceKes) {
      return false;
    }
    if (keywordTokens.length > 0) {
      const kwScore = scoreProduct(product, keywordTokens);
      const vScore = vectorBoost.get(product.id) || 0;
      // Keep keyword-matched OR strong vector neighbors
      if (kwScore === 0 && vScore < 0.45) return false;
      const scentTokens = scentKeywordTokens(keywordTokens);
      if (scentTokens.length > 0 && kwScore > 0 && scoreProduct(product, scentTokens) === 0) {
        return false;
      }
    }
    return true;
  });

  // Include strong vector hits that passed filters but were missing from keyword-only set
  if (vectorBoost.size && keywordTokens.length > 0) {
    for (const [id, vScore] of vectorBoost) {
      if (vScore < 0.45) continue;
      if (results.some((p) => p.id === id)) continue;
      const product = byId.get(id);
      if (!product || !isProductAvailable(product)) continue;
      if (category && product.category !== category) continue;
      if (maxPriceKes != null && product.priceKes != null && product.priceKes > maxPriceKes) continue;
      if (minPriceKes != null && product.priceKes != null && product.priceKes < minPriceKes) continue;
      if (scope && scope !== "all" && product.scope !== scope) continue;
      results.push(product);
    }
  }

  if (keywordTokens.length > 0) {
    results.sort((a, b) => {
      const sa =
        scoreProduct(a, keywordTokens) + (vectorBoost.get(a.id) || 0) * 8;
      const sb =
        scoreProduct(b, keywordTokens) + (vectorBoost.get(b.id) || 0) * 8;
      return sb - sa;
    });
  } else {
    results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  if (results.some(isPerfumeOil)) {
    results = dedupePerfumeOilVariants(results, keywordTokens);
  }

  if (limit == null || limit <= 0 || limit >= 5000) {
    return results;
  }
  return results.slice(0, limit);
}

/** All in-stock items in a category/subcategory (deduped perfume scents). */
export async function listCategoryProducts({ category, subcategory, scope, fulfillment } = {}) {
  return searchProducts({
    category,
    subcategory,
    scope,
    fulfillment,
    limit: 5000,
  });
}

/** Browse taxonomy listing (Phase 2 — Women / Men / Sale / etc.). */
export async function listBrowseProducts({
  browseCategory,
  browseSubCategory,
  maxPriceKes,
  legacyCategory,
  legacySubcategory,
  scope = "local",
  fulfillment = "store",
} = {}) {
  if (legacyCategory || legacySubcategory) {
    return searchProducts({
      category: legacyCategory,
      subcategory: legacySubcategory,
      scope,
      fulfillment,
      maxPriceKes,
      limit: 5000,
    });
  }
  return searchProducts({
    browseCategory,
    browseSubCategory,
    scope,
    fulfillment,
    maxPriceKes,
    limit: 5000,
  });
}

export async function listPerfumeScentFamilies() {
  const products = await loadProducts();
  const families = [];
  const seen = new Set();
  for (const p of products) {
    if (!isPerfumeOil(p) || !isProductAvailable(p)) continue;
    const family = scentFamilyName(p);
    if (seen.has(family)) continue;
    seen.add(family);
    families.push(family);
  }
  return families;
}

export async function getPerfumeVariantsForFamily(familyName) {
  const products = await loadProducts();
  const target = normalizeFamilyKey(familyName);
  return products
    .filter(
      (p) =>
        isPerfumeOil(p) &&
        isProductAvailable(p) &&
        normalizeFamilyKey(scentFamilyName(p)) === target
    )
    .sort((a, b) => (a.volumeMl || 0) - (b.volumeMl || 0));
}

export async function getPerfumeProductByFamilyAndSize(familyName, volumeMl) {
  const variants = await getPerfumeVariantsForFamily(familyName);
  return variants.find((v) => v.volumeMl === volumeMl) || null;
}

function normalizeFamilyKey(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export async function getDealOfTheDay({ scope = "all", limit = 3 } = {}) {
  const products = await loadProducts();
  const filtered = products.filter((product) => {
    if (!isProductAvailable(product)) return false;
    if (scope === "all") return true;
    return product.scope === scope;
  });

  const withDiscount = filtered
    .filter((product) => product.originalPriceKes && product.priceKes)
    .map((product) => ({
      ...product,
      discountPct: Math.round((1 - product.priceKes / product.originalPriceKes) * 100),
    }))
    .sort((a, b) => b.discountPct - a.discountPct);

  const rest = filtered.filter((product) => !product.originalPriceKes);

  return [...withDiscount, ...rest].slice(0, limit);
}

export async function getProductById(id) {
  const products = await loadProducts();
  return products.find((product) => product.id === id) || null;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "i", "me", "my", "we", "you", "can", "could", "would", "please",
  "get", "give", "show", "find", "want", "need", "looking", "for", "about", "what",
  "how", "is", "are", "do", "does", "this", "that", "these", "those", "more", "info",
  "on", "in", "at", "to", "of", "and", "or", "best", "recommend", "recommendations",
  "please", "tell", "some", "any", "good", "nice", "de", "la", "le", "el", "di", "du",
  "poa", "sawa", "sasa", "mambo", "habari", "niko", "fit", "buda", "leo", "kama", "tu",
  "na", "kwa", "ya", "au", "ndio", "ndiyo", "gani", "gania", "nataka", "nipee", "nipe",
]);

/** Maps common shopper words to catalog tokens / subcategories. */
const QUERY_EXPANSIONS = {
  tv: ["tv", "television", "tvs", "smart"],
  laundry: ["laundry", "washing", "washer", "washing-machines"],
  phone: ["phone", "smartphone", "mobile", "phones-tablets", "smartphones", "simu"],
  laptop: ["laptop", "laptops", "computing"],
  fridge: ["fridge", "refrigerator", "kitchen-appliances"],
  game: ["game", "gaming", "console", "consoles"],
  perfume: ["perfume", "perfume-oil", "perfume-oils", "fragrance", "fragrances", "cologne", "scent", "attar", "mafuta", "marashi"],
  simu: ["phone", "smartphone", "smartphones", "phones-tablets"],
  sauti: ["speaker", "speakers", "headphones", "soundbar", "audio", "tvs-audio"],
  spika: ["speaker", "speakers", "soundbar"],
  nguo: ["fashion", "clothing"],
  viatu: ["shoes", "fashion"],
  sandal: ["sandals", "shoes", "fashion"],
  sandals: ["sandals", "shoes", "fashion"],
  shoe: ["shoes", "fashion"],
  shoes: ["shoes", "fashion"],
  lotion: ["lotion", "skincare", "body", "health-beauty"],
  kiondo: ["kiondo", "handwoven", "bag", "bags", "basket", "artisan", "sisal"],
  basket: ["basket", "kiondo", "handwoven", "woven", "bags"],
  leso: ["leso", "khanga", "kitenge", "wrap", "fashion"],
  kitenge: ["kitenge", "ankara", "wax", "print", "dress", "fashion"],
  sneakers: ["sneakers", "shoes", "trainers", "kicks", "footwear"],
  denim: ["denim", "jeans", "jacket", "fashion"],
  yogurt: ["yogurt", "yoghurt"],
  yoghurt: ["yoghurt", "yogurt"],
  mug: ["mug", "mugs", "cup", "cups"],
  bag: ["bag", "bags", "handbag", "tote"],
  hat: ["hat", "hats", "cap", "caps"],
};

function expandKeywordTokens(raw) {
  if (!raw) return [];
  const normalized = normalizeShopperQuery(raw);
  const base = normalized
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t) && (t.length >= 3 || t === "tv" || /^\d+ml$/.test(t)));

  const expanded = new Set(base);
  for (const token of base) {
    for (const [key, aliases] of Object.entries(QUERY_EXPANSIONS)) {
      if (token.includes(key) || aliases.some((a) => token.includes(a.replace(/-/g, "")))) {
        aliases.forEach((a) => expanded.add(a));
      }
    }
    if (token === "tvs" || token === "tv") {
      expanded.add("tv");
      expanded.add("television");
      expanded.add("televisions");
    }
    if (token.includes("laundry") || token.includes("wash")) {
      expanded.add("laundry");
      expanded.add("washing");
      expanded.add("washing-machines");
    }
  }
  return [...expanded];
}

/** Product name inside quotes — e.g. website "Ask on WhatsApp" deep links. */
export function extractQuotedProductName(text) {
  const s = String(text || "");
  const dbl = s.match(/"([^"]{4,120})"/);
  if (dbl) return dbl[1].trim();
  const singles = s.match(/'([^']{6,120})'/g);
  if (singles) {
    for (const m of singles) {
      const inner = m.slice(1, -1).trim();
      if (inner.includes(" ") || /\d/.test(inner)) return inner;
    }
  }
  return null;
}

export function isWebsiteReferralMessage(text) {
  return /\btell me more about\b|\bi(?:'d| would) like to order\b|\bfrom your site\b|\bwas browsing\b|\bsokonimall\b/i.test(
    String(text || "")
  );
}

function matchProductByNameInText(text, products, { storeOnly = false } = {}) {
  const lower = String(text || "").toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const p of products) {
    if (!isProductAvailable(p)) continue;
    if (storeOnly && p.fulfillment !== "store") continue;
    const name = p.name.toLowerCase();
    if (lower.includes(name) && name.length > bestLen) {
      best = p;
      bestLen = name.length;
    }
  }
  return best;
}

function fuzzyProductHit(guess, products, { storeOnly = false } = {}) {
  const g = guess.toLowerCase();
  return (
    products.find(
      (p) =>
        (!storeOnly || p.fulfillment === "store") &&
        isProductAvailable(p) &&
        (g.includes(p.name.toLowerCase().slice(0, 14)) ||
          p.name.toLowerCase().includes(g.slice(0, 20)))
    ) || null
  );
}

export async function findProductFromWebsiteMessage(text) {
  if (!text) return null;
  const quoted = extractQuotedProductName(text);
  if (quoted) return findProductFromMessage(quoted, { allProducts: true });
  if (isWebsiteReferralMessage(text)) return findProductFromMessage(text, { allProducts: true });
  return null;
}

/** Try to pull a product from quoted text, product cards, or numbered list lines. */
export async function findProductFromMessage(text, { allProducts = false } = {}) {
  if (!text) return null;
  if (looksLikeDeliveryDetails(text)) return null;
  if (isMenuBoilerplate(text)) return null;

  const products = await loadProducts();
  const storeOnly = !allProducts;

  const quoted = extractQuotedProductName(text);
  if (quoted) {
    const byQuote = matchProductByNameInText(quoted, products, { storeOnly: false });
    if (byQuote) return byQuote;
  }

  const numberedLine = text.match(/^\d+\.\s*\*?([^*\n]+?)\*?(?:\n|$)/m);
  if (numberedLine) {
    const guess = numberedLine[1].trim();
    if (!isMenuBoilerplate(guess)) {
      const hit = fuzzyProductHit(guess, products, { storeOnly });
      if (hit) return hit;
    }
  }

  const priceLine = text.match(/(.{8,}?)\s+(?:KES|≈\s*KES|\$)\s*[\d,]+/i);
  if (priceLine) {
    const guess = priceLine[1].split("\n").pop().replace(/\*/g, "").trim();
    const hit = fuzzyProductHit(guess, products, { storeOnly: false });
    if (hit) return hit;
  }

  const byName = matchProductByNameInText(text, products, { storeOnly });
  if (byName) return byName;

  const searchOpts = { keywords: quoted || text, limit: 5 };
  if (storeOnly) {
    searchOpts.fulfillment = "store";
    searchOpts.scope = "local";
  }
  const searched = await searchProducts(searchOpts);
  if (searched.length === 1) return searched[0];
  if (searched.length > 1) {
    const tokens = expandKeywordTokens(quoted || text);
    searched.sort((a, b) => scoreProduct(b, tokens) - scoreProduct(a, tokens));
    if (scoreProduct(searched[0], tokens) > 0) return searched[0];
  }
  return null;
}

function isMenuBoilerplate(text) {
  const t = String(text || "").toLowerCase();
  return (
    /what next|reply with the number|pick your size|pick an item|do you mean|type \*menu\*|pay on delivery\)\s*$/i.test(
      t
    ) ||
    /^🛒 order|^🤖 ask|^⬅️? main menu/i.test(t.trim()) ||
    (/^\d+\.\s*🛒/i.test(t) && !/kes|perfume|ml|tv|phone|kg/i.test(t))
  );
}

function productHaystack(product) {
  return [
    product.name,
    product.description,
    product.brand,
    product.category,
    product.subcategory,
    product.browseCategory,
    product.browseSubCategory,
    ...(product.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreProduct(product, tokens) {
  const hay = productHaystack(product);
  const nameHay = String(product.name || "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (isSizeToken(token)) continue;
    // Allow 3-char merchandise tokens (mug, bag, hat, oil) — was <4 which dropped them
    if (token.length < 3 && token !== "tv") continue;
    if (!hay.includes(token)) continue;
    const weight = token.length >= 4 ? 2 : 1;
    score += weight;
    if (nameHay.includes(token)) score += 2;
  }
  return score;
}

function isSizeToken(token) {
  return /^\d+ml$/.test(token) || /^1l$|^1litre$|^litre$|^liter$/.test(token);
}

function scentKeywordTokens(tokens) {
  return tokens.filter((t) => !isSizeToken(t));
}

function isPerfumeOil(product) {
  return product.subcategory === "perfume-oils" || String(product.id || "").startsWith("po-");
}

/** "SAUVAGE DIOR — 100ml Perfume Oil" → "SAUVAGE DIOR" */
export function scentFamilyName(product) {
  if (!isPerfumeOil(product)) return product.name;
  const parts = String(product.name).split(" — ");
  return parts[0]?.trim() || product.name;
}

function parseSizeMlFromTokens(tokens) {
  for (const t of tokens) {
    if (/^1l$|^1litre$|^litre$|^liter$/.test(t)) return 1000;
    const m = t.match(/^(\d+)ml$/);
    if (m) return Number(m[1]);
  }
  return null;
}

function pickVariantForFamily(variants, keywordTokens = []) {
  if (!variants?.length) return null;
  if (variants.length === 1) return variants[0];

  const wantMl = parseSizeMlFromTokens(keywordTokens);
  if (wantMl != null) {
    const exact = variants.find((v) => v.volumeMl === wantMl);
    if (exact) return exact;
    const byName = variants.find((v) => v.name.toLowerCase().includes(`${wantMl}ml`));
    if (byName) return byName;
  }

  return (
    variants.find((v) => v.volumeMl === 100) ||
    variants.find((v) => /100ml/i.test(v.name)) ||
    variants.find((v) => v.volumeMl === 50) ||
    [...variants].sort((a, b) => (a.volumeMl || 0) - (b.volumeMl || 0))[0]
  );
}

/** One row per scent — avoids 4× sizes of "1 MILLION" in browse/search lists. */
function dedupePerfumeOilVariants(products, keywordTokens = []) {
  const families = new Map();
  const other = [];

  for (const p of products) {
    if (!isPerfumeOil(p)) {
      other.push(p);
      continue;
    }
    const family = scentFamilyName(p);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(p);
  }

  if (families.size === 0) return products;

  const familyOrder = [];
  const seen = new Set();
  for (const p of products) {
    if (!isPerfumeOil(p)) continue;
    const family = scentFamilyName(p);
    if (!seen.has(family)) {
      seen.add(family);
      familyOrder.push(family);
    }
  }

  const deduped = familyOrder
    .map((family) => pickVariantForFamily(families.get(family), keywordTokens))
    .filter(Boolean);

  return [...other, ...deduped];
}
