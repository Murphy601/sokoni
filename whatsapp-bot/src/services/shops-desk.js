/**
 * Admin Sellers & Shops desk — enriched shop rows + item gallery payloads.
 * Builds on suppliers.json + products.json + orders (existing model — no duplicate shops table).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listShopsForAdminReview,
  getSupplier,
  patchSupplierAdmin,
  setSellerShopStatus,
} from "./suppliers.js";
import { listAllOrders } from "./orders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTER_CATALOG = path.join(__dirname, "..", "data", "products.json");

async function loadCatalogProducts() {
  try {
    const raw = await readFile(MASTER_CATALOG, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : [];
  } catch {
    return [];
  }
}

function productStatus(p) {
  if (p?.moderation?.hidden || p?.hidden || p?.adminHidden) {
    const labels = p?.moderation?.labels || [];
    if (labels.includes("admin_takedown") || p?.moderation?.reason) return "flagged";
    return "hidden";
  }
  if (p?.inStock === false || Number(p?.stock) === 0) return "out_of_stock";
  return "active";
}

function thumbOf(p) {
  return p?.imageUrl || (Array.isArray(p?.images) && p.images[0]) || p?.image || "";
}

function salesForSupplier(supplierId) {
  const sid = String(supplierId || "");
  let orderCount = 0;
  let escrowKes = 0;
  for (const o of listAllOrders()) {
    if (String(o.supplierId || "") !== sid) continue;
    const paid =
      o.customerPaymentStatus === "confirmed" || o.paid || o.paymentStatus === "paid";
    if (!paid) continue;
    orderCount += 1;
    escrowKes +=
      Number(o.buyerTotalKes) ||
      Number(o.priceKes) + Number(o.shippingKes || 0) ||
      Number(o.priceKes) ||
      0;
  }
  return { orderCount, escrowKes: Math.round(escrowKes) };
}

/** High-density desk rows for admin Sellers & Shops table. */
export async function listShopsDesk({ q = "", status = "all" } = {}) {
  const products = await loadCatalogProducts();
  const bySupplier = new Map();
  for (const p of products) {
    const sid = String(p.supplierId || "").trim();
    if (!sid) continue;
    if (!bySupplier.has(sid)) bySupplier.set(sid, []);
    bySupplier.get(sid).push(p);
  }

  const needle = String(q || "").trim().toLowerCase().replace(/^@/, "");
  const shops = listShopsForAdminReview({ status: status || "all" }).filter((s) => {
    if (!needle) return true;
    const hay = [s.shopHandle, s.businessName, s.phone, s.mpesaNumber, s.id, s.city]
      .map((x) => String(x || "").toLowerCase())
      .join(" ");
    return hay.includes(needle) || hay.replace(/@/g, "").includes(needle);
  });

  return shops.map((s) => {
    const full = getSupplier(s.id) || {};
    const items = bySupplier.get(s.id) || [];
    const active = items.filter((p) => productStatus(p) === "active");
    const thumbs = [...active, ...items]
      .map((p) => ({
        url: thumbOf(p),
        priceKes: Number(p.priceKes ?? p.price) || 0,
        id: p.id,
      }))
      .filter((t) => t.url);
    const seen = new Set();
    const uniqueThumbs = [];
    for (const t of thumbs) {
      if (seen.has(t.url)) continue;
      seen.add(t.url);
      uniqueThumbs.push(t);
      if (uniqueThumbs.length >= 4) break;
    }
    const sales = salesForSupplier(s.id);
    return {
      ...s,
      sellerName: full.contactName || full.ownerName || full.businessName || s.businessName,
      isVerified: Boolean(full.isSellerVerified || full.kycStatus === "approved"),
      verifiedBadge: Boolean(full.verifiedBadge ?? full.isSellerVerified),
      commissionPct:
        full.commissionPct != null
          ? Number(full.commissionPct)
          : full.platformCommissionPct != null
            ? Number(full.platformCommissionPct)
            : null,
      listingCount: items.length,
      activeListingCount: active.length,
      thumbs: uniqueThumbs,
      escrowKes: sales.escrowKes,
      orderCount: sales.orderCount,
      shopUrl: s.shopHandle
        ? `/shop.html?handle=${encodeURIComponent(String(s.shopHandle).replace(/^@/, ""))}`
        : null,
    };
  });
}

/** Item gallery for one shop. */
export async function listShopItemsForAdmin(supplierId) {
  const sid = String(supplierId || "").trim();
  const supplier = getSupplier(sid);
  if (!supplier) return { error: "not_found", message: "Shop not found." };
  const products = await loadCatalogProducts();
  const items = products
    .filter((p) => String(p.supplierId || "") === sid)
    .map((p) => ({
      id: p.id,
      name: p.name || p.title || p.id,
      priceKes: Number(p.priceKes ?? p.price) || 0,
      imageUrl: thumbOf(p),
      images: Array.isArray(p.images)
        ? p.images.filter(Boolean)
        : thumbOf(p)
          ? [thumbOf(p)]
          : [],
      stock: p.stock != null ? Number(p.stock) : p.inStock === false ? 0 : null,
      inStock: p.inStock !== false,
      status: productStatus(p),
      moderation: p.moderation || null,
      browseCategory: p.browseCategory || null,
    }));
  return {
    ok: true,
    shop: {
      id: supplier.id,
      businessName: supplier.businessName,
      shopHandle: supplier.shopHandle,
      phone: supplier.phone,
      shopStatus: supplier.shopStatus || "live",
      verifiedBadge: Boolean(supplier.verifiedBadge ?? supplier.isSellerVerified),
    },
    items,
  };
}

export function setShopVerifiedBadge(supplierId, verified = true) {
  return patchSupplierAdmin(supplierId, {
    verifiedBadge: Boolean(verified),
    isSellerVerified: Boolean(verified),
    isVerifiedStore: Boolean(verified),
  });
}

export function setShopCommissionOverride(supplierId, percent) {
  return patchSupplierAdmin(supplierId, { commissionPct: percent });
}

export function setShopPayoutHold(supplierId, { hold = true, note = "" } = {}) {
  return patchSupplierAdmin(supplierId, {
    payoutHold: Boolean(hold),
    payoutHoldNote: note,
    note,
  });
}

export function overrideShopHandle(supplierId, handle) {
  return patchSupplierAdmin(supplierId, { shopHandle: handle });
}

export function freezeShop(supplierId, { note = "" } = {}) {
  return setSellerShopStatus(supplierId, {
    status: "paused",
    note: note || "Frozen by admin",
    holdPayouts: true,
  });
}

export function editShopProfile(supplierId, { name, phone, bio, shopHandle } = {}) {
  const patch = {};
  if (name != null) patch.businessName = name;
  if (phone != null) patch.phone = phone;
  if (bio != null) patch.description = bio;
  if (shopHandle != null) patch.shopHandle = shopHandle;
  return patchSupplierAdmin(supplierId, patch);
}
