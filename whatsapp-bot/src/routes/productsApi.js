import { Router } from "express";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDbEnabled, pingDb } from "../db/pool.js";
import { isCatalogPubliclyDisabled } from "../services/catalog-guard.js";
import {
  createProductListing,
  getProductById,
  searchProductsDb,
  countSearchProductsDb,
  getCategoriesFromDb,
  getBrowseCountsFromDb,
  countProducts,
} from "../db/repositories/products.js";
import { toggleProductLike, listLikedProductIds } from "../db/repositories/social.js";
import { CONDITION_LABELS } from "../db/product-mapper.js";
import { resolveStorefrontImageUrl, resolveStorefrontVideoUrl } from "../lib/catalog-images.js";
import { computeProductTotals } from "../services/shipping-tiers.js";
import { publicPromoFields } from "../lib/public-promo.js";
import { resolveAuthenticatedSellerSocialContext } from "../services/seller-social-auth.js";
import { applyBuyerIdentityAuth } from "../services/buyer-social-auth.js";
import { notifySellerProductLiked } from "../services/social-notifications.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROWSE_MENU_PATH = path.join(__dirname, "..", "..", "..", "website", "data", "browse-menu.json");

const PRICE_TIERS = {
  "under-1000": 1000,
  "under-2500": 2500,
  "under-5000": 5000,
  "under-10000": 10000,
};

/** @type {{ categories?: Array<Record<string, unknown>> } | null} */
let cachedBrowseMenu = null;

function getBrowseMenuSync() {
  if (cachedBrowseMenu) return cachedBrowseMenu;
  try {
    cachedBrowseMenu = JSON.parse(readFileSync(BROWSE_MENU_PATH, "utf-8"));
  } catch {
    cachedBrowseMenu = { categories: [] };
  }
  return cachedBrowseMenu;
}

/** Public product shape — never expose source cost or supplier URL. */
function toPublicProduct(p) {
  if (!p) return null;
  const totals = computeProductTotals(p);
  const promoFields = publicPromoFields(p, { totalKes: totals.totalKes });
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
    size: p.size,
    genderFit: p.genderFit,
    description: p.description,
    isSecondhand: p.isSecondhand,
    condition: p.condition,
    conditionLabel: p.conditionLabel,
    stockQuantity: p.stockQuantity,
    priceKes: totals.totalKes,
    priceUsd: p.priceUsd,
    originalPriceKes: promoFields.originalPriceKes,
    compareAtPrice: promoFields.compareAtPrice,
    onPromo: promoFields.onPromo || undefined,
    discountPct: promoFields.discountPct || undefined,
    promo: promoFields.promo,
    rating: p.rating,
    reviews: p.reviews,
    source: p.scope === "international" ? p.source : "Sokoni",
    businessName: p.businessName,
    sellerHandle: p.sellerHandle,
    shopHandle: p.shopHandle,
    sellerUserId: p.sellerUserId,
    sellerAvatarUrl: p.sellerAvatarUrl,
    isSellerVerified: Boolean(p.isSellerVerified),
    sellerTrust: p.sellerTrust || {
      unrated: true,
      displayLabel: "UNRATED",
      avgRating: 0,
      totalReviews: 0,
      badgeTier: "newbie",
      badges: [{ id: "newbie", label: "Newbie", icon: "newbie" }],
      isSellerVerified: Boolean(p.isSellerVerified),
      salesCount: 0,
    },
    scope: p.scope,
    fulfillment: p.fulfillment,
    payment: p.payment,
    emoji: p.emoji,
    tags: p.tags,
    inStock: p.inStock,
    imageUrl: resolveStorefrontImageUrl(p) || p.imageUrl,
    images: Array.isArray(p.images)
      ? p.images.map((img, idx) => {
          if (idx === 0) return resolveStorefrontImageUrl(p) || img;
          if (/^https?:\/\//i.test(String(img || ""))) return img;
          return resolveStorefrontImageUrl({ id: p.id, imageUrl: img }) || img;
        })
      : p.images,
    videoUrl: resolveStorefrontVideoUrl(p) || undefined,
    videoKind: p.videoKind === "seller" || p.videoKind === "preview" ? p.videoKind : undefined,
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

  // Nav aliases (Phones → electronics/phones) from browse-menu.json
  try {
    const menu = getBrowseMenuSync();
    if (browseCategory && menu?.categories) {
      const cat = menu.categories.find((c) => c.id === browseCategory);
      const sub = browseSubCategory
        ? cat?.subcategories?.find((s) => s.id === browseSubCategory)
        : null;
      const resolved =
        sub?.resolvesTo ||
        (!browseSubCategory ? cat?.resolvesTo : null) ||
        (cat?.resolvesTo && sub ? cat.resolvesTo : null);
      if (resolved?.browse) {
        browseCategory = resolved.browse;
        if (resolved.sub != null) browseSubCategory = resolved.sub;
      }
    }
  } catch {
    /* keep raw filters */
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

function createProductErrorStatus(error) {
  if (error === "database_not_configured") return 503;
  if (error === "seller_not_found") return 404;
  return 400;
}

function socialErrorStatus(error) {
  if (error === "database_not_configured") return 503;
  if (error === "session_required" || error === "session_invalid" || error === "session_expired") return 401;
  if (error === "buyer_session_mismatch") return 403;
  if (error === "user_not_found" || error === "product_not_found") return 404;
  return 400;
}

/**
 * POST /api/products/create
 * Mandatory metadata: size, condition, genderFit (+ title, price, cover image).
 */
router.post("/create", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req, { requireSellerRecord: true });
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerId = Number(req.body?.sellerId);
    if (Number.isInteger(requestedSellerId) && requestedSellerId > 0 && requestedSellerId !== auth.sellerId) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const payload = { ...(req.body || {}), sellerId: auth.sellerId };
    try {
      const { findSupplierByPhone, getSupplier } = await import("../services/suppliers.js");
      const { assertSupplierCanSell } = await import("../services/enforce-account.js");
      const supplier =
        (auth.phone && findSupplierByPhone(auth.phone)) ||
        (auth.supplierId ? getSupplier(auth.supplierId) : null);
      const sellGate = assertSupplierCanSell(supplier?.id || auth.supplierId);
      if (!sellGate.ok) {
        return res.status(403).json({
          error: "shop_unavailable",
          shopStatus: sellGate.shopStatus,
          message:
            sellGate.shopStatus === "paused"
              ? "Your store is paused by Administration — new listings are disabled."
              : sellGate.message || "This store is currently unavailable.",
        });
      }
    } catch {
      /* fail-soft */
    }
    const result = await createProductListing(payload);
    if (result.error) {
      return res
        .status(createProductErrorStatus(result.error))
        .json({ error: result.error, message: result.message });
    }
    res.status(201).json({ success: true, product: toPublicProduct(result.product) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/products/like — toggle or set like by { userId, productId, liked? } */
router.post("/like", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "userId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const result = await toggleProductLike(gated.payload || {});
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    if (result.newlyLiked) {
      void notifySellerProductLiked({
        userId: result.userId,
        productId: result.productId,
      });
    }
    res.json({
      liked: result.liked,
      likesCount: result.likesCount,
      userId: result.userId,
      productId: result.productId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/products/likes?productIds=a,b,c — viewer liked subset for feed hydration */
router.get("/likes", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(
      req,
      {
        ...(req.query || {}),
        userId: req.query?.userId || req.query?.viewer || req.query?.viewerUserId,
      },
      "userId"
    );
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }

    const userId = gated.payload?.userId;
    if (gated.softUnauthed && !userId) {
      return res.json({ likedProductIds: [], userId: null });
    }

    const result = await listLikedProductIds({
      userId,
      productIds: req.query?.productIds,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    // Filter on full DB shape (supplierId / sellerPhone) BEFORE stripping to public.
    let visible = items;
    try {
      const { blockedShopLookup, isProductFromBlockedShop } = await import(
        "../services/enforce-account.js"
      );
      const blocked = blockedShopLookup();
      visible = items.filter((p) => !isProductFromBlockedShop(p, blocked));
    } catch {
      /* fail-soft */
    }
    const products = visible.map(toPublicProduct);
    res.json({
      total: Math.max(0, total - (items.length - visible.length)),
      count: products.length,
      offset,
      limit,
      products,
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
    if (
      !product ||
      product.isSold === true ||
      (!product.inStock && req.query.includeHidden !== "true")
    ) {
      return res.status(404).json({ error: "not_found" });
    }
    try {
      const { assertProductShopVisible } = await import("../services/enforce-account.js");
      const sellGate = assertProductShopVisible(product);
      if (!sellGate.ok) {
        return res.status(403).json({
          error: "shop_unavailable",
          shopStatus: sellGate.shopStatus,
          message: sellGate.message || "Item Temporarily Unavailable",
          product: {
            ...toPublicProduct(product),
            purchaseable: false,
            temporarilyUnavailable: true,
          },
        });
      }
    } catch {
      /* fail-soft */
    }
    res.json({ product: toPublicProduct(product) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
