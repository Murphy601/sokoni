import { Router } from "express";
import { isDbEnabled, pingDb } from "../db/pool.js";
import {
  getProductById,
  searchProductsDb,
  getCategoriesFromDb,
  countProducts,
} from "../db/repositories/products.js";
import { CONDITION_LABELS } from "../db/product-mapper.js";

const router = Router();

/** Public product shape — never expose source cost or supplier URL. */
function toPublicProduct(p) {
  if (!p) return null;
  const pub = {
    id: p.id,
    name: p.name,
    title: p.title,
    category: p.category,
    subcategory: p.subcategory,
    brand: p.brand,
    color: p.color,
    description: p.description,
    isSecondhand: p.isSecondhand,
    condition: p.condition,
    conditionLabel: p.conditionLabel,
    stockQuantity: p.stockQuantity,
    priceKes: p.priceKes,
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

router.get("/meta", async (_req, res) => {
  const db = await pingDb();
  res.json({
    dbEnabled: isDbEnabled(),
    dbConnected: db.ok,
    dbError: db.ok ? null : db.reason,
    productCount: db.ok ? await countProducts() : null,
    conditions: CONDITION_LABELS,
    itemTypes: [
      { value: "all", label: "All Items" },
      { value: "new", label: "Brand New", filter: { isSecondhand: false } },
      { value: "secondhand", label: "Pre-Loved / Thrift", filter: { isSecondhand: true } },
    ],
  });
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
  if (!isDbEnabled()) {
    return res.status(503).json({ error: "database_not_configured" });
  }
  try {
    const limit = Math.min(Number(req.query.limit) || 48, 500);
    const items = await searchProductsDb({
      category: req.query.category || undefined,
      subcategory: req.query.subcategory || undefined,
      keywords: req.query.q || req.query.keywords || undefined,
      maxPriceKes: req.query.maxPrice != null ? Number(req.query.maxPrice) : undefined,
      minPriceKes: req.query.minPrice != null ? Number(req.query.minPrice) : undefined,
      scope: req.query.scope || undefined,
      fulfillment: req.query.fulfillment || undefined,
      isSecondhand:
        req.query.itemType === "secondhand"
          ? true
          : req.query.itemType === "new"
            ? false
            : undefined,
      condition: req.query.condition || undefined,
      inStockOnly: req.query.includeHidden !== "true",
      limit,
    });
    res.json({
      count: items.length,
      products: items.map(toPublicProduct),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
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
