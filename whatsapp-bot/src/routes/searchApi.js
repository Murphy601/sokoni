/**
 * Public smart search API (Typesense/Algolia-style facade for the storefront).
 * GET /api/search?q=kiondo
 * GET /api/search/suggest?q=kio
 */
import { Router } from "express";
import { smartSearch, smartSuggest } from "../services/smart-search.js";
import { computeProductTotals } from "../services/shipping-tiers.js";
import { resolveStorefrontImageUrl } from "../lib/catalog-images.js";

const router = Router();

function toPublic(p) {
  if (!p) return null;
  const totals = computeProductTotals(p);
  return {
    id: p.id,
    name: p.name,
    priceKes: totals.totalKes,
    originalPriceKes: p.originalPriceKes,
    browseCategory: p.browseCategory,
    browseSubCategory: p.browseSubCategory,
    category: p.category,
    subcategory: p.subcategory,
    brand: p.brand,
    tags: p.tags || [],
    isSecondhand: Boolean(p.isSecondhand),
    condition: p.condition,
    imageUrl: resolveStorefrontImageUrl(p) || p.imageUrl,
    shopHandle: p.shopHandle,
    rating: p.rating,
  };
}

router.get("/", async (req, res) => {
  const q = String(req.query.q || req.query.query || req.query.keywords || "").trim();
  if (!q) {
    return res.status(400).json({ error: "missing_query", message: "Pass ?q= (e.g. kiondo)" });
  }
  try {
    const result = await smartSearch({
      q,
      limit: Number(req.query.limit) || 16,
      browseCategory: req.query.browse || req.query.browseCategory || null,
      browseSubCategory: req.query.browseSub || req.query.browseSubCategory || null,
      maxPriceKes: req.query.maxPriceKes != null ? Number(req.query.maxPriceKes) : null,
    });
    res.json({
      ok: true,
      engine: result.engine,
      query: result.query,
      expandedQuery: result.expandedQuery,
      suggestions: result.suggestions,
      count: result.count,
      products: (result.products || []).map(toPublic).filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ error: "search_failed", message: err.message });
  }
});

router.get("/suggest", async (req, res) => {
  try {
    res.json(await smartSuggest(String(req.query.q || ""), { limit: Number(req.query.limit) || 8 }));
  } catch (err) {
    res.status(500).json({ error: "suggest_failed", message: err.message });
  }
});

export default router;
