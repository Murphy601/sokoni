import { Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDbEnabled, pingDb } from "../db/pool.js";
import { isCatalogPubliclyDisabled } from "../services/catalog-guard.js";
import {
  getProductById,
  searchProductsDb,
  countSearchProductsDb,
  getCategoriesFromDb,
  getBrowseCountsFromDb,
  countProducts,
} from "../db/repositories/products.js";
import { CONDITION_LABELS } from "../db/product-mapper.js";
import { computeProductTotals } from "../services/shipping-tiers.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROWSE_MENU_PATH = path.join(__dirname, "..", "..", "..", "website", "data", "browse-menu.json");

const PRICE_TIERS = {
  "under-1000": 1000,
  "under-2500": 2500,
  "under-5000": 5000,
  "under-10000": 10000,
};

/** Public product shape — never expose source cost or supplier URL. */
function toPublicProduct(p) {
  if (!p) return null;
  const totals = computeProductTotals(p);
  const pub = {
    id: p.id,
    name: p.name,
    title: p.title,
    category: p.category,
    subcategory: p.subcategory,
    browseCategory: p.browseCategory,
    browseSubCategory: p.browseSubCategory,
    brand: p.brand,
    color: p.color,
    description: p.description,
    isSecondhand: p.isSecondhand,
    condition: p.condition,
    conditionLabel: p.conditionLabel,
    stockQuantity: p.stockQuantity,
    priceKes: totals.itemKes,
    shippingKes: totals.shippingKes,
    totalKes: totals.totalKes,
    priceUsd: p.priceUsd,
    originalPriceKes: p.originalPriceKes,
    rating: p.rating,
    reviews: p.reviews,
    source: p.scope === "international" ? p.source : "Sokoni",
    scope: p.scope,
    fulfillment: p.fulfillment,
    payment: p.payment,
    emoji: p.emoji,
    tags: p.tags,
    inStock: p.inStock,
    imageUrl: p.imageUrl,
    images: p.images,
    estDeliveryDays: p.estDeliveryDays,
    volumeMl: p.volumeMl,
  };
  return Object.fromEntries(Object.entries(pub).filter(([, v]) => v !== undefined));
}

function parseItemType(itemType) {
  if (itemType === "secondhand") return true;
  if (itemType === "new") return false;
  return undefined;
}

function resolveBrowseFilters(query) {
  let browseCategory = query.browse || query.browseCategory || undefined;
  let browseSubCategory = query.browseSub || query.browseSubCategory || undefined;
  let maxPriceKes = query.maxPrice != null ? Number(query.maxPrice) : undefined;

  if (query.priceTier && PRICE_TIERS[query.priceTier]) {
    maxPriceKes = PRICE_TIERS[query.priceTier];
    if (!browseCategory) browseCategory = "sale";
    if (!browseSubCategory) browseSubCategory = query.priceTier;
  }

  if (browseCategory === "sale" && browseSubCategory && PRICE_TIERS[browseSubCategory]) {
    maxPriceKes = PRICE_TIERS[browseSubCategory];
  }

  return { browseCategory, browseSubCategory, maxPriceKes };
}

function buildListFilters(req) {
  const browse = resolveBrowseFilters(req.query);
  return {
    category: req.query.category || undefined,
    subcategory: req.query.subcategory || undefined,
    browseCategory: browse.browseCategory,
    browseSubCategory: browse.browseSubCategory,
    keywords: req.query.q || req.query.keywords || undefined,
    maxPriceKes: browse.maxPriceKes,
    minPriceKes: req.query.minPrice != null ? Number(req.query.minPrice) : undefined,
    scope: req.query.scope || undefined,
    fulfillment: req.query.fulfillment || undefined,
    isSecondhand: parseItemType(req.query.itemType),
    condition: req.query.condition || undefined,
    inStockOnly: req.query.includeHidden !== "true",
  };
}

router.get("/meta", async (_req, res) => {
  const disabled = await isCatalogPubliclyDisabled();
  const db = await pingDb();
  res.json({
    catalogPaused: disabled,
    dbEnabled: isDbEnabled(),
    dbConnected: db.ok,
    dbError: db.ok ? null : db.reason,
    productCount: disabled ? 0 : db.ok ? await countProducts() : null,
    conditions: CONDITION_LABELS,
    itemTypes: [
      { value: "all", label: "All Items" },
      { value: "new", label: "Brand New", filter: { isSecondhand: false } },
      { value: "secondhand", label: "Pre-Loved / Thrift", filter: { isSecondhand: true } },
    ],
    priceTiers: Object.entries(PRICE_TIERS).map(([id, maxKes]) => ({
      id,
      maxKes,
      label: `Under KES ${maxKes.toLocaleString()}`,
    })),
  });
});

router.get("/browse-menu", async (_req, res) => {
  try {
    const raw = await readFile(BROWSE_MENU_PATH, "utf-8");
    res.type("json").send(raw);
  } catch {
    res.status(404).json({ error: "browse_menu_not_found" });
  }
});

router.get("/browse-counts", async (_req, res) => {
  if (!isDbEnabled()) {
    return res.status(503).json({ error: "database_not_configured" });
  }
  try {
    const counts = await getBrowseCountsFromDb();
    res.json({ counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/categories", async (_req, res) => {
  if (!isDbEnabled()) {
    return res.status(503).json({ error: "database_not_configured" });
  }
  try {
    const categories = await getCategoriesFromDb();
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  if (await isCatalogPubliclyDisabled()) {
    return res.json({ total: 0, count: 0, offset: 0, limit: 0, products: [], catalogPaused: true });
  }
  if (!isDbEnabled()) {
    return res.status(503).json({ error: "database_not_configured" });
  }
  try {
    const limit = Math.min(Number(req.query.limit) || 48, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const filters = buildListFilters(req);
    const [items, total] = await Promise.all([
      searchProductsDb({ ...filters, limit, offset }),
      countSearchProductsDb(filters),
    ]);
    res.json({
      total,
      count: items.length,
      offset,
      limit,
      products: items.map(toPublicProduct),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  if (await isCatalogPubliclyDisabled()) {
    return res.status(404).json({ error: "catalog_paused" });
  }
  if (!isDbEnabled()) {
    return res.status(503).json({ error: "database_not_configured" });
  }
  try {
    const product = await getProductById(req.params.id);
    if (!product || (!product.inStock && req.query.includeHidden !== "true")) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json({ product: toPublicProduct(product) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
