/**
 * Sold-item durability: once a SKU is sold, it must never reappear as live stock.
 *
 * Append-only registry (sold-skus.json) survives RMW races on products.json.
 * Apply locks before every public catalog build and before restock/restore.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const REGISTRY_PATH = path.join(DATA_DIR, "sold-skus.json");
const MASTER_PRODUCTS = path.join(DATA_DIR, "products.json");

let cachedRegistry = null;
let cachedRegistryAt = 0;
const CACHE_MS = 2000;

/** True when the listing was sold via prepaid escrow (or tombstoned). */
export function isProductSold(product) {
  if (!product || typeof product !== "object") return false;
  if (product.isSold === true) return true;
  if (product.soldAt != null && Number(product.soldAt) > 0) return true;
  if (product.soldOrderId) return true;
  return false;
}

/** Shopper-visible: in stock, not sold, and units remaining when tracked. */
export function isProductAvailable(product) {
  if (!product || typeof product !== "object") return false;
  if (isProductSold(product)) return false;
  if (product.inStock === false) return false;
  if (product.stockQuantity != null && Number(product.stockQuantity) <= 0) return false;
  return true;
}

/** Units on hand — defaults to 1 for classic thrift/single SKUs. Sums variants when present. */
export function productStockOnHand(product) {
  if (!product || typeof product !== "object") return 0;
  const variants = listProductVariants(product);
  if (variants.length) {
    return variants.reduce((sum, v) => sum + Math.max(0, Math.round(Number(v.stockQuantity) || 0)), 0);
  }
  if (product.stockQuantity != null && Number.isFinite(Number(product.stockQuantity))) {
    return Math.max(0, Math.round(Number(product.stockQuantity)));
  }
  if (isProductSold(product) || product.inStock === false) return 0;
  return 1;
}

/** Low-stock threshold for seller alerts (Hub badge + WhatsApp). */
export const LOW_STOCK_THRESHOLD = 2;

export function isLowStock(product) {
  const onHand = productStockOnHand(product);
  return onHand > 0 && onHand <= LOW_STOCK_THRESHOLD;
}

/**
 * Size/color variants on one listing.
 * Shape: { id, size?, color?, stockQuantity, sku? }
 */
export function listProductVariants(product) {
  if (!product || !Array.isArray(product.variants)) return [];
  return product.variants
    .filter((v) => v && typeof v === "object")
    .map((v, i) => ({
      id: String(v.id || `var_${i + 1}`).trim(),
      size: v.size != null ? String(v.size).trim() : "",
      color: v.color != null ? String(v.color).trim() : "",
      stockQuantity: Math.max(0, Math.round(Number(v.stockQuantity) || 0)),
      sku: v.sku != null ? String(v.sku).trim() : "",
    }));
}

export function findVariant(product, variantId) {
  const id = String(variantId || "").trim();
  if (!id) return null;
  return listProductVariants(product).find((v) => v.id === id) || null;
}

/** Normalize + write variants; syncs parent stockQuantity to the sum. */
export function applyProductVariants(product, rawVariants) {
  if (!product || typeof product !== "object") return product;
  const list = Array.isArray(rawVariants) ? rawVariants : [];
  const variants = list.slice(0, 40).map((v, i) => {
    const size = String(v?.size || "").trim().slice(0, 40);
    const color = String(v?.color || "").trim().slice(0, 40);
    const qty = Math.max(0, Math.min(9999, Math.round(Number(v?.stockQuantity ?? v?.qty) || 0)));
    const id =
      String(v?.id || "")
        .trim()
        .slice(0, 48) ||
      `var_${Date.now().toString(36)}_${i}`;
    return {
      id,
      size,
      color,
      stockQuantity: qty,
      sku: String(v?.sku || "").trim().slice(0, 64),
      label: [size, color].filter(Boolean).join(" / ") || `Option ${i + 1}`,
    };
  });
  product.variants = variants;
  const sum = variants.reduce((s, v) => s + v.stockQuantity, 0);
  applyStockQuantityFields(product, sum);
  product.variantsUpdatedAt = Date.now();
  return product;
}

/**
 * Block checkout when requested qty exceeds on-hand (and optional variant).
 * @returns {{ ok: true, onHand: number } | { ok: false, error, message, onHand }}
 */
export function assertPurchaseQty(product, qty = 1, { variantId = null } = {}) {
  if (!product || typeof product !== "object") {
    return { ok: false, error: "missing_product", message: "Product not found.", onHand: 0 };
  }
  if (isProductSold(product) || product.inStock === false) {
    return { ok: false, error: "out_of_stock", message: "This item is sold out.", onHand: 0 };
  }
  const bought = Math.max(1, Math.round(Number(qty) || 1));
  if (variantId) {
    const v = findVariant(product, variantId);
    if (!v) {
      return { ok: false, error: "variant_not_found", message: "That size/colour is not available.", onHand: 0 };
    }
    if (v.stockQuantity < bought) {
      return {
        ok: false,
        error: "insufficient_stock",
        message:
          v.stockQuantity <= 0
            ? "That size/colour is sold out."
            : `Only ${v.stockQuantity} left for that size/colour.`,
        onHand: v.stockQuantity,
      };
    }
    return { ok: true, onHand: v.stockQuantity };
  }
  const onHand = productStockOnHand(product);
  if (onHand < bought) {
    return {
      ok: false,
      error: "insufficient_stock",
      message: onHand <= 0 ? "This item is sold out." : `Only ${onHand} unit${onHand === 1 ? "" : "s"} left.`,
      onHand,
    };
  }
  return { ok: true, onHand };
}

/** Stamp sold fields onto a product object (mutates and returns). */
export function markProductSoldFields(product, { orderId = null, soldAt = Date.now() } = {}) {
  if (!product || typeof product !== "object") return product;
  product.inStock = false;
  product.isSold = true;
  product.soldAt = product.soldAt || soldAt;
  product.stockQuantity = 0;
  if (orderId) product.soldOrderId = String(orderId);
  return product;
}

/** Soft out-of-stock (multi-unit sold out) — restockable, not a permanent tombstone. */
export function markProductSoftOutOfStock(product) {
  if (!product || typeof product !== "object") return product;
  product.inStock = false;
  product.isSold = false;
  product.stockQuantity = 0;
  delete product.soldAt;
  delete product.soldOrderId;
  return product;
}

/** Apply a seller stock update (units). Clears soft OOS when qty > 0. */
export function applyStockQuantityFields(product, qty) {
  if (!product || typeof product !== "object") return product;
  const n = Math.max(0, Math.round(Number(qty) || 0));
  product.stockQuantity = n;
  if (n > 0) {
    product.inStock = true;
    product.isSold = false;
    delete product.soldAt;
    delete product.soldOrderId;
  } else {
    product.inStock = false;
  }
  return product;
}

/**
 * Decrement stock after a paid order.
 * Multi-unit stays live until units hit 0 (soft OOS, restockable).
 * Unique 1-of-1 thrift gets a permanent sold tombstone.
 * When variantId is set, decrements that variant then resyncs parent total.
 */
export function consumeStockForSale(product, { qty = 1, orderId = null, soldAt = Date.now(), variantId = null } = {}) {
  if (!product || typeof product !== "object") {
    return { product, depleted: true, tombstone: false, remaining: 0, onHand: 0 };
  }
  const bought = Math.max(1, Math.round(Number(qty) || 1));
  const variants = listProductVariants(product);

  if (variants.length && variantId) {
    const nextVariants = variants.map((v) => ({ ...v }));
    const idx = nextVariants.findIndex((v) => v.id === String(variantId));
    if (idx === -1) {
      return { product, depleted: false, tombstone: false, remaining: productStockOnHand(product), onHand: productStockOnHand(product), error: "variant_not_found" };
    }
    const onHandVar = nextVariants[idx].stockQuantity;
    nextVariants[idx].stockQuantity = Math.max(0, onHandVar - bought);
    const next = applyProductVariants({ ...product }, nextVariants);
    const remaining = productStockOnHand(next);
    if (remaining > 0) {
      return { product: next, depleted: false, tombstone: false, remaining, onHand: onHandVar };
    }
    if (onHandVar <= 1 && variants.length === 1) {
      markProductSoldFields(next, { orderId, soldAt });
      return { product: next, depleted: true, tombstone: true, remaining: 0, onHand: onHandVar };
    }
    markProductSoftOutOfStock(next);
    next.variants = nextVariants;
    return { product: next, depleted: true, tombstone: false, remaining: 0, onHand: onHandVar };
  }

  if (variants.length && !variantId) {
    // No variant picked — consume from the first variant with stock, then fall through to parent total.
    const nextVariants = variants.map((v) => ({ ...v }));
    let left = bought;
    for (const v of nextVariants) {
      if (left <= 0) break;
      const take = Math.min(v.stockQuantity, left);
      v.stockQuantity -= take;
      left -= take;
    }
    const next = applyProductVariants({ ...product }, nextVariants);
    const remaining = productStockOnHand(next);
    const onHand = variants.reduce((s, v) => s + v.stockQuantity, 0);
    if (remaining > 0) {
      return { product: next, depleted: false, tombstone: false, remaining, onHand };
    }
    markProductSoftOutOfStock(next);
    next.variants = nextVariants;
    return { product: next, depleted: true, tombstone: false, remaining: 0, onHand };
  }

  const onHand = productStockOnHand(product);
  const remaining = Math.max(0, onHand - bought);
  const next = { ...product, stockQuantity: remaining };

  if (remaining > 0) {
    next.inStock = true;
    return { product: next, depleted: false, tombstone: false, remaining, onHand };
  }

  // Depleted: permanent sold only for classic single-unit listings.
  if (onHand <= 1) {
    markProductSoldFields(next, { orderId, soldAt });
    return { product: next, depleted: true, tombstone: true, remaining: 0, onHand };
  }

  markProductSoftOutOfStock(next);
  return { product: next, depleted: true, tombstone: false, remaining: 0, onHand };
}

/**
 * Preserve sold state when merging an existing row with an incoming patch.
 * Never clears isSold / soldAt / soldOrderId once set.
 */
export function preserveSoldState(existing, incoming) {
  if (!incoming || typeof incoming !== "object") return incoming;
  const base = existing && typeof existing === "object" ? existing : null;
  const sold = isProductSold(base) || isProductSold(incoming);
  if (!sold) return { ...incoming };

  const out = { ...incoming };
  markProductSoldFields(out, {
    orderId: out.soldOrderId || base?.soldOrderId || null,
    soldAt: out.soldAt || base?.soldAt || Date.now(),
  });
  return out;
}

async function readRegistryRaw() {
  try {
    const raw = await readFile(REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { version: 1, skus: {} };
    if (!parsed.skus || typeof parsed.skus !== "object") parsed.skus = {};
    return parsed;
  } catch {
    return { version: 1, skus: {} };
  }
}

export async function loadSoldRegistry({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedRegistry && now - cachedRegistryAt < CACHE_MS) {
    return cachedRegistry;
  }
  cachedRegistry = await readRegistryRaw();
  cachedRegistryAt = now;
  return cachedRegistry;
}

export function clearSoldRegistryCache() {
  cachedRegistry = null;
  cachedRegistryAt = 0;
}

async function writeRegistry(registry) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const payload = {
    version: 1,
    skus: registry.skus || {},
    updatedAt: new Date().toISOString(),
  };
  await writeFile(REGISTRY_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  cachedRegistry = payload;
  cachedRegistryAt = Date.now();
  return payload;
}

export async function clearSoldSku(productId) {
  const id = String(productId || "").trim();
  if (!id) return { ok: false, error: "missing_product_id" };
  const reg = await loadSoldRegistry({ force: true });
  if (!reg.skus?.[id]) return { ok: true, cleared: false, productId: id };
  delete reg.skus[id];
  await writeRegistry(reg);
  return { ok: true, cleared: true, productId: id };
}

export async function isSkuSold(productId) {
  const id = String(productId || "").trim();
  if (!id) return false;
  const reg = await loadSoldRegistry();
  return Boolean(reg.skus?.[id]);
}

/**
 * Permanently record a sold SKU. Idempotent — keeps earliest soldAt / orderId.
 */
export async function recordSoldSku(productId, { orderId = null, soldAt = Date.now() } = {}) {
  const id = String(productId || "").trim();
  if (!id) return { error: "missing_product_id" };

  const reg = await loadSoldRegistry({ force: true });
  const prev = reg.skus[id];
  if (!prev) {
    reg.skus[id] = {
      soldAt: Number(soldAt) || Date.now(),
      orderId: orderId ? String(orderId) : null,
    };
  } else {
    reg.skus[id] = {
      soldAt: Math.min(Number(prev.soldAt) || Date.now(), Number(soldAt) || Date.now()),
      orderId: prev.orderId || (orderId ? String(orderId) : null),
    };
  }
  await writeRegistry(reg);
  return { ok: true, productId: id, entry: reg.skus[id] };
}

/** Force sold fields on any product whose id is in the registry (or already sold). */
export async function applySoldLocks(products) {
  if (!Array.isArray(products)) return products;
  const reg = await loadSoldRegistry();
  const skus = reg.skus || {};
  return products.map((p) => {
    if (!p || typeof p !== "object") return p;
    const entry = skus[p.id];
    if (!entry && !isProductSold(p)) return p;
    const next = { ...p };
    markProductSoldFields(next, {
      orderId: entry?.orderId || next.soldOrderId || null,
      soldAt: entry?.soldAt || next.soldAt || Date.now(),
    });
    return next;
  });
}

/**
 * Seed registry from master products that already have isSold, then re-apply locks.
 * Call after catalog writes that might race with a sale.
 */
export async function enforceSoldLocksOnMaster() {
  let master;
  try {
    master = JSON.parse(await readFile(MASTER_PRODUCTS, "utf-8"));
  } catch {
    return { ok: false, error: "master_unreadable" };
  }
  if (!Array.isArray(master)) return { ok: false, error: "master_not_array" };

  const reg = await loadSoldRegistry({ force: true });
  let registryDirty = false;
  for (const p of master) {
    if (!p?.id || !isProductSold(p)) continue;
    if (!reg.skus[p.id]) {
      reg.skus[p.id] = {
        soldAt: Number(p.soldAt) || Date.now(),
        orderId: p.soldOrderId ? String(p.soldOrderId) : null,
      };
      registryDirty = true;
    }
  }
  if (registryDirty) await writeRegistry(reg);

  const locked = await applySoldLocks(master);
  let changed = false;
  for (let i = 0; i < locked.length; i += 1) {
    const a = master[i];
    const b = locked[i];
    if (
      a.inStock !== b.inStock ||
      a.isSold !== b.isSold ||
      a.soldAt !== b.soldAt ||
      a.soldOrderId !== b.soldOrderId
    ) {
      changed = true;
      break;
    }
  }
  if (changed) {
    await writeFile(MASTER_PRODUCTS, JSON.stringify(locked, null, 2) + "\n", "utf-8");
  }
  return { ok: true, changed, soldCount: Object.keys(reg.skus).length };
}

/** Reject restock/restore when the SKU is sold or tombstoned. */
export async function assertCanRestock(productId, product = null) {
  const id = String(productId || "").trim();
  if (!id) return { ok: false, error: "missing_product_id" };
  if (product && isProductSold(product)) {
    return { ok: false, error: "product_sold", message: "Sold items cannot be put back in stock." };
  }
  if (await isSkuSold(id)) {
    return { ok: false, error: "product_sold", message: "Sold items cannot be put back in stock." };
  }
  return { ok: true };
}

export { REGISTRY_PATH, MASTER_PRODUCTS };
