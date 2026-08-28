/**
 * Typo-tolerant catalog search (Typesense/Algolia-style facade).
 * In-process by default; optional TYPESENSE_HOST can be wired later without
 * changing /api/search or WhatsApp tool contracts.
 */
import { searchProducts, getProductById } from "./catalog.js";
import { normalizeShopperQuery } from "./shopper-language.js";

/** Shopper phrase → browse / category suggestions + expanded keywords. */
export const SEARCH_SYNONYMS = {
  kiondo: {
    label: "Handwoven Bags",
    suggestions: ["Handwoven Bags", "Artisan Goods", "Baskets"],
    keywords: ["kiondo", "handwoven", "bag", "bags", "basket", "artisan", "sisal"],
  },
  basket: {
    label: "Artisan Goods",
    suggestions: ["Handwoven Bags", "Home & Office", "Artisan Goods"],
    keywords: ["basket", "kiondo", "handwoven", "woven"],
  },
  leso: {
    label: "Fashion",
    suggestions: ["Fashion", "Kitenge", "Women"],
    keywords: ["leso", "khanga", "kitenge", "wrap", "fashion"],
  },
  kitenge: {
    label: "Fashion",
    suggestions: ["Fashion", "Women", "Artisan Goods"],
    keywords: ["kitenge", "ankara", "wax", "print", "dress", "fashion"],
  },
  sneakers: {
    label: "Shoes",
    suggestions: ["Shoes", "Fashion", "Streetwear"],
    keywords: ["sneakers", "shoes", "trainers", "kicks", "footwear"],
  },
  denim: {
    label: "Fashion",
    suggestions: ["Fashion", "Jeans", "Streetwear"],
    keywords: ["denim", "jeans", "jacket", "fashion"],
  },
  perfume: {
    label: "Health & Beauty",
    suggestions: ["Perfume oils", "Health & Beauty", "Fragrance"],
    keywords: ["perfume", "fragrance", "attar", "mafuta", "marashi"],
  },
  simu: {
    label: "Phones & Tablets",
    suggestions: ["Phones & Tablets", "Smartphones"],
    keywords: ["phone", "smartphone", "simu", "mobile"],
  },
};

function levenshtein(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const row = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) row[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const tmp = row[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[t.length];
}

function tokenize(q) {
  return normalizeShopperQuery(q)
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && t.length >= 2);
}

function expandWithSynonyms(tokens) {
  const out = new Set(tokens);
  const suggestions = [];
  const seenSuggest = new Set();
  for (const token of tokens) {
    for (const [key, meta] of Object.entries(SEARCH_SYNONYMS)) {
      const hit =
        token === key ||
        token.includes(key) ||
        key.includes(token) ||
        levenshtein(token, key) <= (token.length >= 5 ? 2 : 1);
      if (!hit) continue;
      (meta.keywords || []).forEach((k) => out.add(k));
      for (const s of meta.suggestions || []) {
        if (seenSuggest.has(s)) continue;
        seenSuggest.add(s);
        suggestions.push(s);
      }
    }
  }
  return { tokens: [...out], suggestions };
}

function fuzzyBlobScore(blob, tokens) {
  const text = String(blob || "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (text.includes(token)) {
      score += 8;
      continue;
    }
    // Typo tolerance against words in the blob
    const words = text.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    let best = Infinity;
    for (const w of words) {
      if (Math.abs(w.length - token.length) > 2) continue;
      best = Math.min(best, levenshtein(token, w));
    }
    if (best <= 1) score += 5;
    else if (best === 2 && token.length >= 5) score += 2;
  }
  return score;
}

/**
 * Smart search: synonym expansion + typo-tolerant re-rank on top of catalog search.
 */
export async function smartSearch({
  q = "",
  keywords = "",
  limit = 12,
  browseCategory = null,
  browseSubCategory = null,
  maxPriceKes = null,
} = {}) {
  const query = String(q || keywords || "").trim();
  const baseTokens = tokenize(query);
  const { tokens, suggestions } = expandWithSynonyms(baseTokens);
  const expandedQuery = tokens.join(" ");

  let products = await searchProducts({
    keywords: expandedQuery || query,
    browseCategory: browseCategory || undefined,
    browseSubCategory: browseSubCategory || undefined,
    maxPriceKes: maxPriceKes != null ? Number(maxPriceKes) : undefined,
    limit: Math.max(Number(limit) || 12, 24),
  });

  // Hybrid fallback: keyword scorer can miss short tokens / description-only hits.
  // Re-scan live catalog with fuzzy blob (name+description+brand+tags) when empty.
  if (!products.length && (expandedQuery || query)) {
    const pool = await searchProducts({
      browseCategory: browseCategory || undefined,
      browseSubCategory: browseSubCategory || undefined,
      maxPriceKes: maxPriceKes != null ? Number(maxPriceKes) : undefined,
      limit: 5000,
    });
    products = pool
      .map((p) => {
        const blob = [
          p.name,
          p.description,
          p.brand,
          p.category,
          p.subcategory,
          p.browseCategory,
          p.browseSubCategory,
          ...(p.tags || []),
        ].join(" ");
        return { p, score: fuzzyBlobScore(blob, tokens) };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || (b.p.rating || 0) - (a.p.rating || 0))
      .map((row) => row.p)
      .slice(0, Math.max(Number(limit) || 12, 24));
  }

  // Soft typo re-rank
  if (baseTokens.length && products.length) {
    products = products
      .map((p) => {
        const blob = [
          p.name,
          p.description,
          p.brand,
          p.category,
          p.subcategory,
          p.browseCategory,
          p.browseSubCategory,
          ...(p.tags || []),
        ].join(" ");
        return { p, score: fuzzyBlobScore(blob, tokens) };
      })
      .filter((row) => row.score > 0 || !baseTokens.length)
      .sort((a, b) => b.score - a.score || (b.p.rating || 0) - (a.p.rating || 0))
      .map((row) => row.p);
  }

  const capped = products.slice(0, Math.min(Math.max(Number(limit) || 12, 1), 40));

  return {
    ok: true,
    engine: "sokoni-smart",
    query,
    expandedQuery,
    suggestions: suggestions.slice(0, 6),
    count: capped.length,
    products: capped,
  };
}

/** Lightweight autocomplete suggestions for the storefront search bar. */
export async function smartSuggest(q = "", { limit = 8 } = {}) {
  const query = String(q || "").trim();
  if (query.length < 2) {
    return { ok: true, suggestions: Object.values(SEARCH_SYNONYMS).flatMap((s) => s.suggestions).slice(0, limit) };
  }
  const result = await smartSearch({ q: query, limit: 6 });
  const fromProducts = (result.products || []).map((p) => p.name).filter(Boolean);
  const merged = [...(result.suggestions || []), ...fromProducts];
  const uniq = [];
  const seen = new Set();
  for (const s of merged) {
    const key = String(s).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
    if (uniq.length >= limit) break;
  }
  return { ok: true, query, suggestions: uniq };
}

export async function getSmartProduct(id) {
  return getProductById(id);
}
