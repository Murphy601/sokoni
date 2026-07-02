import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_PATH = path.join(__dirname, "..", "data", "products.json");

let cachedProducts = null;

/**
 * Loads the curated product catalog. In v1 this is a static JSON file you
 * (or a VA) maintain by hand with the best products per category. Phase 2
 * can replace this with a real database and/or pull live prices from
 * supplier product-feed APIs where the affiliate program provides one
 * (Jumia and Amazon both offer limited feeds to approved affiliates).
 */
async function loadProducts() {
  if (!cachedProducts) {
    const raw = await readFile(PRODUCTS_PATH, "utf-8");
    cachedProducts = JSON.parse(raw);
  }
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
 */
export async function searchProducts({
  category,
  subcategory,
  keywords,
  maxPriceKes,
  minPriceKes,
  source,
  scope,
  limit = 3,
} = {}) {
  const products = await loadProducts();

  const keywordTokens = keywords
    ? keywords.toLowerCase().split(/\s+/).filter(Boolean)
    : [];

  const results = products.filter((product) => {
    if (category && product.category !== category) return false;
    if (subcategory && product.subcategory !== subcategory) return false;
    if (source && product.source !== source) return false;
    if (scope && product.scope !== scope) return false;
    if (maxPriceKes != null && product.priceKes != null && product.priceKes > maxPriceKes) {
      return false;
    }
    if (minPriceKes != null && product.priceKes != null && product.priceKes < minPriceKes) {
      return false;
    }
    if (keywordTokens.length > 0) {
      const haystack = [product.name, product.category, product.subcategory, ...(product.tags || [])]
        .join(" ")
        .toLowerCase();
      const matchesAny = keywordTokens.some((token) => haystack.includes(token));
      if (!matchesAny) return false;
    }
    return true;
  });

  results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  return results.slice(0, limit);
}

export async function getDealOfTheDay({ scope = "all", limit = 3 } = {}) {
  const products = await loadProducts();
  const filtered = products.filter((product) => {
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
