import { isDbEnabled, query } from "../pool.js";
import {
  computeOfferFeeBreakdown,
  serializeOfferBreakdown,
} from "../../services/shipping-tiers.js";
import { resolveStorefrontImageUrl } from "../../lib/catalog-images.js";
import { CONDITION_LABELS } from "../product-mapper.js";
import { getOrder, getOrdersForCustomer } from "../../services/orders.js";
import { getProductById } from "../../services/catalog.js";
import { getSupplier } from "../../services/suppliers.js";

/** Shared product columns for offer hydration (includes shipping for escrow math). */
const OFFER_PRODUCT_SELECT = `
       p.title AS product_title,
       p.price_kes AS product_price_kes,
       p.shipping_kes AS product_shipping_kes,
       p.primary_image_url AS product_image_url`;

function parseUserId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseOfferId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseOrderId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function formatHandle(value, fallback = "") {
  const raw = String(value || fallback || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

const OFFER_STATUSES = new Set(["pending", "accepted", "declined", "expired"]);

const FORBIDDEN_PATTERNS = [
  /07\d{8}/,
  /01\d{8}/,
  /\+254\d{9}/,
  /\b254\d{9}\b/,
  /pay outside/i,
  /direct till/i,
  /send cash/i,
  /\b(?:wa\.me|whatsapp\.com|t\.me|telegram)\b/i,
  /\b(?:instagram\.com|facebook\.com|fb\.com|tiktok\.com)\b/i,
  /\b(?:call|text|dm)\s*(?:me|us)\b/i,
  /https?:\/\//i,
  /www\.\w+/i,
  /\btill\s*[#:]?\s*\d{5,}/i,
  /buy\s*goods/i,
];

const DEFAULT_OFFER_REMINDER_COOLDOWN_SECONDS = 60;
const MAX_OFFER_REMINDER_COOLDOWN_SECONDS = 600;
const MAX_HANDLED_QUEUE_OFFER_IDS = 200;
const HANDLED_QUEUE_EVENT_ACTIONS = new Set(["handled", "unhandled", "reset"]);
const DEFAULT_HANDLED_QUEUE_EVENTS_LIMIT = 50;
const MAX_HANDLED_QUEUE_EVENTS_LIMIT = 200;

async function userExists(userId) {
  const { rows } = await query(`SELECT 1 FROM users WHERE id = $1 LIMIT 1`, [userId]);
  return Boolean(rows[0]);
}

function parseCooldownSeconds(value, fallback = DEFAULT_OFFER_REMINDER_COOLDOWN_SECONDS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return Math.min(Math.max(normalized, 5), MAX_OFFER_REMINDER_COOLDOWN_SECONDS);
}

function parseOfferIdList(value, maxItems = MAX_HANDLED_QUEUE_OFFER_IDS) {
  const chunks = Array.isArray(value) ? value : [value];
  const ids = [];
  const seen = new Set();
  chunks.forEach((chunk) => {
    String(chunk || "")
      .split(",")
      .forEach((raw) => {
        const id = parseOfferId(raw);
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
      });
  });
  return ids.slice(0, maxItems);
}

function parseHandledFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return null;
}

function normalizeHandledQueueEventSource(value, fallback = "seller_dashboard") {
  const source = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 64);
  return source || fallback;
}

function parseListLimit(value, fallback = DEFAULT_HANDLED_QUEUE_EVENTS_LIMIT, max = MAX_HANDLED_QUEUE_EVENTS_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function parseListOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(Math.floor(parsed), 0);
}

function formatKesAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return "KES 0";
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

function offerReminderMessage(offer) {
  const title = offer?.product_title || offer?.product_id || "your item";
  const amount = formatKesAmount(offer?.amount_kes);
  return `Hi! I accepted your offer of ${amount} (buyer total incl. shipping + Sokoni fee) for "${title}". Please complete checkout on Sokoni within 24 hours — funds go to escrow until delivery.`;
}

function resolveOfferBreakdown(amountKes, shippingKes) {
  const agreed = Math.round(Number(amountKes) || 0);
  const ship = Math.round(Number(shippingKes) || 0);
  const freeShipping = ship === 0;
  return computeOfferFeeBreakdown(agreed, ship, { freeShipping });
}

function offerBreakdownError(breakdown) {
  if (!breakdown?.error) return null;
  return {
    error: breakdown.error,
    message: breakdown.message,
    minBuyerTotalKes: breakdown.minBuyerTotalKes ?? null,
    shippingKes: breakdown.shippingKes ?? null,
    agreedBuyerTotalKes: breakdown.agreedBuyerTotalKes ?? null,
  };
}

async function productExists(productId) {
  const { rows } = await query(`SELECT 1 FROM products WHERE id = $1 LIMIT 1`, [productId]);
  return Boolean(rows[0]);
}

const ORDER_SELECT_WITH_SELLER = `
  SELECT
    o.id,
    o.tracking_code,
    o.status,
    o.buyer_id,
    o.buyer_phone,
    (
      SELECT COALESCE(p.seller_user_id, s.user_id)
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN sellers s ON s.id = oi.seller_id
      WHERE oi.order_id = o.id
      ORDER BY oi.id ASC
      LIMIT 1
    ) AS seller_user_id
  FROM orders o`;

async function getPostgresOrderByReference(orderRef) {
  const raw = String(orderRef || "").trim();
  if (!raw) return null;

  const numericId = parseOrderId(raw);
  if (numericId) {
    const byId = await query(`${ORDER_SELECT_WITH_SELLER} WHERE o.id = $1 LIMIT 1`, [numericId]);
    if (byId.rows[0]) return { ...byId.rows[0], source: "postgres" };
  }

  const byTracking = await query(`${ORDER_SELECT_WITH_SELLER} WHERE UPPER(o.tracking_code) = $1 LIMIT 1`, [
    raw.toUpperCase(),
  ]);
  if (byTracking.rows[0]) return { ...byTracking.rows[0], source: "postgres" };
  return null;
}

async function lookupSellerUserIdByKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0) {
    const byUser = await query(`SELECT id AS user_id FROM users WHERE id = $1 LIMIT 1`, [numeric]);
    if (byUser.rows[0]?.user_id != null) return Number(byUser.rows[0].user_id);
    const bySellerId = await query(`SELECT user_id FROM sellers WHERE id = $1 LIMIT 1`, [numeric]);
    if (bySellerId.rows[0]?.user_id != null) return Number(bySellerId.rows[0].user_id);
  }
  const handle = raw.replace(/^@+/, "").toLowerCase();
  const bySlug = await query(
    `SELECT user_id FROM sellers WHERE LOWER(slug) = LOWER($1) LIMIT 1`,
    [handle]
  );
  if (bySlug.rows[0]?.user_id != null) return Number(bySlug.rows[0].user_id);
  return null;
}

async function resolveSellerUserIdForJsonOrder(order) {
  if (!order || typeof order !== "object") return null;

  const productId = String(order.productId || order.product_id || "").trim();
  if (productId) {
    try {
      const product = await getProductById(productId);
      if (product?.sellerUserId != null) {
        const n = Number(product.sellerUserId);
        if (Number.isInteger(n) && n > 0) return n;
      }
      if (product?.supplierId) {
        const fromSupplier = await lookupSellerUserIdByKey(product.supplierId);
        if (fromSupplier) return fromSupplier;
      }
    } catch {
      /* catalog optional */
    }
    try {
      const { rows } = await query(
        `SELECT COALESCE(p.seller_user_id, s.user_id) AS seller_user_id
         FROM products p
         LEFT JOIN sellers s ON s.id = p.seller_id
         WHERE p.id = $1
         LIMIT 1`,
        [productId]
      );
      if (rows[0]?.seller_user_id != null) return Number(rows[0].seller_user_id);
    } catch {
      /* db optional for this lookup */
    }
  }

  const supplierKey = String(order.supplierId || order.supplier_id || "").trim();
  if (supplierKey) {
    try {
      const supplier = getSupplier(supplierKey);
      if (supplier?.userId != null) {
        const n = Number(supplier.userId);
        if (Number.isInteger(n) && n > 0) return n;
      }
      const fromSupplier =
        (await lookupSellerUserIdByKey(supplier?.shopHandle || supplier?.slug || supplierKey)) ||
        (await lookupSellerUserIdByKey(supplierKey));
      if (fromSupplier) return fromSupplier;
    } catch {
      /* ignore */
    }
  }

  return null;
}

async function resolveBuyerUserIdForJsonOrder(order) {
  if (!order || typeof order !== "object") return null;
  const key = String(order.customerKey || "");
  const match = key.match(/^web:buyer:(\d+)$/i);
  if (match) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const phone = String(order.phone || order.mpesaPhone || "").replace(/\D/g, "");
  if (!phone) return null;
  try {
    let digits = phone;
    if (digits.startsWith("0") && digits.length >= 10) digits = `254${digits.slice(1)}`;
    if (digits.length === 9) digits = `254${digits}`;
    const { rows } = await query(
      `SELECT id FROM users WHERE phone = $1 OR phone = $2 LIMIT 1`,
      [digits, phone]
    );
    if (rows[0]?.id != null) return Number(rows[0].id);
  } catch {
    /* ignore */
  }
  return null;
}

function jsonOrderBuyerMatches(order, buyerUserId, buyerPhone = "") {
  const key = String(order?.customerKey || "");
  if (key === `web:buyer:${buyerUserId}`) return true;
  const want = String(buyerPhone || "").replace(/\D/g, "");
  if (!want) return false;
  const norm = (d) => {
    let x = String(d || "").replace(/\D/g, "");
    if (x.startsWith("0") && x.length >= 10) x = `254${x.slice(1)}`;
    if (x.length === 9) x = `254${x}`;
    return x;
  };
  const wantN = norm(want);
  return norm(order?.phone) === wantN || norm(order?.mpesaPhone) === wantN;
}

async function getOrderByReference(orderRef) {
  const raw = String(orderRef || "").trim();
  if (!raw) return null;

  // Prepaid marketplace orders live in JSON as SK-####.
  const jsonOrder = getOrder(raw);
  if (jsonOrder) {
    const sellerUserId = await resolveSellerUserIdForJsonOrder(jsonOrder);
    return {
      source: "json",
      id: null,
      tracking_code: jsonOrder.id,
      status: jsonOrder.status || jsonOrder.shipmentStatus || null,
      buyer_id: null,
      buyer_phone: jsonOrder.phone || null,
      seller_user_id: sellerUserId,
      jsonOrder,
    };
  }

  return getPostgresOrderByReference(raw);
}

async function reviewAlreadyExists({ orderId = null, orderRef = null, direction = "buyer_to_seller" } = {}) {
  const dir = direction === "seller_to_buyer" ? "seller_to_buyer" : "buyer_to_seller";
  if (orderId != null) {
    const byId = await query(
      `SELECT id FROM order_reviews WHERE order_id = $1 AND direction = $2 LIMIT 1`,
      [orderId, dir]
    );
    if (byId.rows[0]) return true;
  }
  if (orderRef) {
    const byRef = await query(
      `SELECT id FROM order_reviews
        WHERE UPPER(order_ref) = UPPER($1) AND direction = $2
        LIMIT 1`,
      [String(orderRef), dir]
    );
    if (byRef.rows[0]) return true;
  }
  return false;
}

async function expirePendingOffers() {
  await query(
    `UPDATE offers
      SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at <= NOW()`
  );
  await query(
    `UPDATE offers
      SET status = 'expired', updated_at = NOW()
     WHERE status = 'accepted'
       AND expires_at IS NOT NULL
       AND expires_at <= NOW()`
  );
}

/**
 * Resolve an accepted (non-expired) offer for prepaid checkout at the agreed buyer total.
 * amount_kes is treated as negotiated buyer all-in (same as listing price_kes).
 */
export async function getAcceptedOfferForCheckout({ offerId, buyerUserId } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const oid = parseOfferId(offerId);
  const buyerId = parseUserId(buyerUserId);
  if (!oid || !buyerId) {
    return {
      error: "invalid_offer_checkout",
      message: "offerId and buyerUserId are required.",
    };
  }

  await expirePendingOffers();

  const { rows } = await query(
    `SELECT
       o.*,
       ${OFFER_PRODUCT_SELECT},
       p.in_stock AS product_in_stock,
       p.is_sold AS product_is_sold,
       buyer.handle AS buyer_handle,
       buyer.shop_name AS buyer_shop_name,
       seller.handle AS seller_handle,
       seller.shop_name AS seller_shop_name
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
     LEFT JOIN users seller ON seller.id = o.seller_user_id
     WHERE o.id = $1
     LIMIT 1`,
    [oid]
  );
  const row = rows[0];
  if (!row) {
    return { error: "offer_not_found", message: "Offer not found." };
  }
  if (Number(row.buyer_user_id) !== buyerId) {
    return { error: "forbidden_offer_checkout", message: "Only the buyer who made this offer can check out." };
  }
  if (row.status !== "accepted") {
    return {
      error: "offer_not_accepted",
      message: row.status === "expired" ? "This offer has expired." : `Offer is ${row.status}.`,
    };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    await query(`UPDATE offers SET status = 'expired', updated_at = NOW() WHERE id = $1`, [oid]);
    return { error: "offer_expired", message: "This accepted offer has expired. Make a new offer." };
  }
  if (row.product_is_sold === true || row.product_in_stock === false) {
    return { error: "product_unavailable", message: "This item is no longer available." };
  }

  const listedTotal =
    row.product_price_kes != null ? Math.round(Number(row.product_price_kes)) : null;
  const agreed = Math.round(Number(row.amount_kes) || 0);
  if (listedTotal != null && agreed > listedTotal) {
    return {
      error: "offer_above_list",
      message: "Agreed offer cannot exceed the listed buyer price.",
    };
  }

  const shippingKes = Math.round(Number(row.product_shipping_kes) || 0);
  const breakdown = resolveOfferBreakdown(agreed, shippingKes);
  const breakdownErr = offerBreakdownError(breakdown);
  if (breakdownErr) return breakdownErr;

  return {
    ok: true,
    offer: mapOfferRow(row),
    productId: row.product_id,
    listedBuyerTotalKes: listedTotal,
    breakdown: serializeOfferBreakdown(breakdown),
  };
}

/**
 * Offers shared between two users (inbox thread context).
 */
export async function listThreadOffers({ userAId, userBId, limit = 20 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const a = parseUserId(userAId);
  const b = parseUserId(userBId);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  if (!a || !b) {
    return { error: "invalid_thread_users", message: "userAId and userBId are required." };
  }
  if (a === b) {
    return { error: "invalid_thread_users", message: "Thread users must be different." };
  }
  if (!(await userExists(a)) || !(await userExists(b))) {
    return { error: "user_not_found", message: "One or both users not found." };
  }

  await expirePendingOffers();

  const { rows } = await query(
    `SELECT
       o.*,
       ${OFFER_PRODUCT_SELECT},
       buyer.handle AS buyer_handle,
       buyer.shop_name AS buyer_shop_name,
       seller.handle AS seller_handle,
       seller.shop_name AS seller_shop_name
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
     LEFT JOIN users seller ON seller.id = o.seller_user_id
     WHERE (
       (o.buyer_user_id = $1 AND o.seller_user_id = $2)
       OR (o.buyer_user_id = $2 AND o.seller_user_id = $1)
     )
     ORDER BY COALESCE(o.updated_at, o.created_at) DESC, o.id DESC
     LIMIT $3`,
    [a, b, safeLimit]
  );

  return { offers: rows.map(mapOfferRow), count: rows.length, limit: safeLimit };
}

/**
 * Toggle or set product like.
 * - omit `liked` → toggle
 * - `liked: true|false` → set absolute state (idempotent; used by bag sync)
 */
export async function toggleProductLike({ userId, productId, liked: likedTarget } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(userId);
  const pid = String(productId || "").trim();
  if (!uid || !pid) {
    return { error: "invalid_request", message: "userId and productId are required." };
  }

  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }
  if (!(await productExists(pid))) {
    return { error: "product_not_found", message: "Product not found." };
  }

  const existing = await query(
    `SELECT id FROM product_likes WHERE user_id = $1 AND product_id = $2 LIMIT 1`,
    [uid, pid]
  );

  const wantLiked =
    likedTarget === true || likedTarget === false || likedTarget === "true" || likedTarget === "false"
      ? likedTarget === true || likedTarget === "true"
      : null;

  let liked = false;
  let newlyLiked = false;
  if (wantLiked === null) {
    if (existing.rows[0]) {
      await query(`DELETE FROM product_likes WHERE id = $1`, [existing.rows[0].id]);
    } else {
      await query(`INSERT INTO product_likes (user_id, product_id) VALUES ($1, $2)`, [uid, pid]);
      liked = true;
      newlyLiked = true;
    }
  } else if (wantLiked) {
    if (!existing.rows[0]) {
      await query(`INSERT INTO product_likes (user_id, product_id) VALUES ($1, $2)`, [uid, pid]);
      newlyLiked = true;
    }
    liked = true;
  } else if (existing.rows[0]) {
    await query(`DELETE FROM product_likes WHERE id = $1`, [existing.rows[0].id]);
  }

  const countResult = await query(
    `SELECT COUNT(*)::int AS likes_count FROM product_likes WHERE product_id = $1`,
    [pid]
  );
  const likesCount = Number(countResult.rows[0]?.likes_count || 0);

  return { liked, newlyLiked, likesCount, userId: uid, productId: pid };
}

export async function listLikedProductIds({ userId, productIds } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(userId);
  if (!uid) {
    return { error: "invalid_request", message: "userId is required." };
  }
  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }

  const ids = (Array.isArray(productIds) ? productIds : String(productIds || "").split(","))
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const uniqueIds = [...new Set(ids)].slice(0, 200);
  if (!uniqueIds.length) {
    return { userId: uid, likedProductIds: [] };
  }

  const { rows } = await query(
    `SELECT product_id
       FROM product_likes
      WHERE user_id = $1
        AND product_id = ANY($2::text[])`,
    [uid, uniqueIds]
  );

  return {
    userId: uid,
    likedProductIds: rows.map((row) => String(row.product_id)),
  };
}

function mapFollowUserRow(row) {
  const handle = formatHandle(row.handle, "");
  return {
    userId: Number(row.id),
    handle: handle || null,
    shopName: row.shop_name || row.display_name || (handle ? handle.slice(1) : `User ${row.id}`),
    displayName: row.display_name || null,
    avatarUrl: row.avatar_url || null,
    isSellerVerified: Boolean(row.is_seller_verified),
    followedAt: row.created_at || null,
  };
}

/**
 * List follow graph for a user.
 * direction: "followers" (people who follow userId) | "following" (people userId follows)
 */
export async function listUserFollowConnections({
  userId,
  direction = "followers",
  limit = 24,
  offset = 0,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(userId);
  if (!uid) {
    return { error: "invalid_user", message: "Valid userId is required." };
  }
  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }

  const normalized = String(direction || "followers")
    .trim()
    .toLowerCase();
  if (normalized !== "followers" && normalized !== "following") {
    return { error: "invalid_direction", message: "direction must be followers or following." };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const joinClause =
    normalized === "followers"
      ? `FROM follows f
         INNER JOIN users u ON u.id = f.follower_user_id
        WHERE f.following_user_id = $1`
      : `FROM follows f
         INNER JOIN users u ON u.id = f.following_user_id
        WHERE f.follower_user_id = $1`;

  const countResult = await query(`SELECT COUNT(*)::int AS total ${joinClause}`, [uid]);
  const total = Number(countResult.rows[0]?.total || 0);

  const { rows } = await query(
    `SELECT
       u.id,
       u.handle,
       u.display_name,
       u.shop_name,
       u.avatar_url,
       u.is_seller_verified,
       f.created_at
     ${joinClause}
     ORDER BY f.created_at DESC
     LIMIT $2 OFFSET $3`,
    [uid, safeLimit, safeOffset]
  );

  return {
    userId: uid,
    direction: normalized,
    users: rows.map(mapFollowUserRow),
    pagination: { limit: safeLimit, offset: safeOffset, total },
  };
}

function cleanOptionalText(value, { max = 500, allowEmpty = true } = {}) {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return allowEmpty ? null : undefined;
  return text.slice(0, max);
}

function normalizeSocialUrl(value, { platforms = [] } = {}) {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.length > 300) {
    return { error: "invalid_social_url", message: "Social link is too long." };
  }

  const handleOnly = raw.replace(/^@+/, "").trim();
  const lower = raw.toLowerCase();

  if (platforms.includes("instagram")) {
    if (/^https?:\/\//i.test(raw)) {
      if (!/instagram\.com/i.test(raw)) {
        return { error: "invalid_social_url", message: "Instagram link must be an instagram.com URL." };
      }
      return raw.slice(0, 300);
    }
    if (/^[a-zA-Z0-9._]{1,30}$/.test(handleOnly)) {
      return `https://instagram.com/${handleOnly}`;
    }
    return { error: "invalid_social_url", message: "Enter an Instagram handle or profile URL." };
  }

  if (platforms.includes("tiktok")) {
    if (/^https?:\/\//i.test(raw)) {
      if (!/tiktok\.com/i.test(raw)) {
        return { error: "invalid_social_url", message: "TikTok link must be a tiktok.com URL." };
      }
      return raw.slice(0, 300);
    }
    if (/^[a-zA-Z0-9._]{2,24}$/.test(handleOnly)) {
      return `https://www.tiktok.com/@${handleOnly}`;
    }
    return { error: "invalid_social_url", message: "Enter a TikTok handle or profile URL." };
  }

  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 300);
  return lower.slice(0, 300);
}

/**
 * Update storefront identity fields on users (+ soft sync sellers row when present).
 * Only provided fields are changed (undefined = leave unchanged).
 */
export async function updateUserShopProfile({
  userId,
  sellerId = null,
  handle,
  shopName,
  bio,
  avatarUrl,
  location,
  instagramUrl,
  tiktokUrl,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(userId);
  if (!uid) {
    return { error: "invalid_user", message: "Valid userId is required." };
  }
  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }

  const nextHandle =
    handle === undefined ? undefined : normalizeHandle(handle);
  if (handle !== undefined && !nextHandle) {
    return { error: "invalid_handle", message: "Enter a valid shop handle." };
  }
  if (nextHandle && !/^[a-z0-9._-]{2,40}$/.test(nextHandle)) {
    return {
      error: "invalid_handle",
      message: "Handle must be 2–40 characters: letters, numbers, . _ -",
    };
  }

  if (nextHandle) {
    const clash = await query(
      `SELECT id FROM users
        WHERE id <> $1
          AND (LOWER(handle) = $2 OR LOWER(handle) = $3)
        LIMIT 1`,
      [uid, nextHandle, `@${nextHandle}`]
    );
    if (clash.rows[0]) {
      return { error: "handle_taken", message: "That shop handle is already taken." };
    }
  }

  const nextShopName = cleanOptionalText(shopName, { max: 255 });
  const nextBio = cleanOptionalText(bio, { max: 1000 });
  const nextAvatar = cleanOptionalText(avatarUrl, { max: 1000 });
  const nextLocation = cleanOptionalText(location, { max: 120 });
  const nextInstagram =
    instagramUrl === undefined ? undefined : normalizeSocialUrl(instagramUrl, { platforms: ["instagram"] });
  if (nextInstagram && nextInstagram.error) return nextInstagram;
  const nextTiktok =
    tiktokUrl === undefined ? undefined : normalizeSocialUrl(tiktokUrl, { platforms: ["tiktok"] });
  if (nextTiktok && nextTiktok.error) return nextTiktok;

  if (
    nextHandle === undefined &&
    nextShopName === undefined &&
    nextBio === undefined &&
    nextAvatar === undefined &&
    nextLocation === undefined &&
    nextInstagram === undefined &&
    nextTiktok === undefined
  ) {
    return { error: "invalid_request", message: "Provide at least one profile field to update." };
  }

  if (nextAvatar && !/^https?:\/\//i.test(nextAvatar)) {
    return { error: "invalid_avatar_url", message: "Avatar must be an http(s) URL." };
  }

  const sets = [];
  const params = [];
  function pushSet(column, value) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (nextHandle !== undefined) pushSet("handle", nextHandle);
  if (nextShopName !== undefined) pushSet("shop_name", nextShopName);
  if (nextBio !== undefined) pushSet("bio", nextBio);
  if (nextAvatar !== undefined) pushSet("avatar_url", nextAvatar);
  if (nextLocation !== undefined) pushSet("location", nextLocation);
  if (nextInstagram !== undefined) pushSet("instagram_url", nextInstagram);
  if (nextTiktok !== undefined) pushSet("tiktok_url", nextTiktok);
  params.push(uid);

  const { rows } = await query(
    `UPDATE users
        SET ${sets.join(", ")}
      WHERE id = $${params.length}
      RETURNING id, handle, shop_name, bio, avatar_url, location, instagram_url, tiktok_url,
               display_name, is_seller_verified, social_wa_notify`,
    params
  );
  const row = rows[0];
  if (!row) {
    return { error: "user_not_found", message: "User not found." };
  }

  const linkedSellerId = parseUserId(sellerId);
  try {
    if (linkedSellerId) {
      const sellerSets = [];
      const sellerParams = [];
      if (nextShopName !== undefined) {
        sellerParams.push(nextShopName);
        sellerSets.push(`business_name = COALESCE($${sellerParams.length}, business_name)`);
      }
      if (nextBio !== undefined) {
        sellerParams.push(nextBio);
        sellerSets.push(`bio = $${sellerParams.length}`);
      }
      if (nextLocation !== undefined) {
        sellerParams.push(nextLocation);
        sellerSets.push(`city = $${sellerParams.length}`);
      }
      if (nextHandle !== undefined) {
        sellerParams.push(nextHandle);
        sellerSets.push(`slug = COALESCE($${sellerParams.length}, slug)`);
      }
      if (sellerSets.length) {
        sellerParams.push(linkedSellerId);
        await query(
          `UPDATE sellers SET ${sellerSets.join(", ")} WHERE id = $${sellerParams.length}`,
          sellerParams
        );
      }
    } else {
      const sellerSets = [];
      const sellerParams = [];
      if (nextShopName !== undefined) {
        sellerParams.push(nextShopName);
        sellerSets.push(`business_name = COALESCE($${sellerParams.length}, business_name)`);
      }
      if (nextBio !== undefined) {
        sellerParams.push(nextBio);
        sellerSets.push(`bio = $${sellerParams.length}`);
      }
      if (nextLocation !== undefined) {
        sellerParams.push(nextLocation);
        sellerSets.push(`city = $${sellerParams.length}`);
      }
      if (nextHandle !== undefined) {
        sellerParams.push(nextHandle);
        sellerSets.push(`slug = COALESCE($${sellerParams.length}, slug)`);
      }
      if (sellerSets.length) {
        sellerParams.push(uid);
        await query(
          `UPDATE sellers SET ${sellerSets.join(", ")} WHERE user_id = $${sellerParams.length}`,
          sellerParams
        );
      }
    }
  } catch {
    // Soft sync — users update already succeeded.
  }

  return {
    shop: {
      userId: Number(row.id),
      handle: formatHandle(row.handle, nextHandle || ""),
      shopName: row.shop_name || row.display_name || `Shop ${row.id}`,
      bio: row.bio || null,
      avatarUrl: row.avatar_url || null,
      location: row.location || null,
      instagramUrl: row.instagram_url || null,
      tiktokUrl: row.tiktok_url || null,
      isSellerVerified: Boolean(row.is_seller_verified),
      socialWaNotify: row.social_wa_notify !== false,
    },
  };
}

/**
 * Read/update WhatsApp social ping preferences for a user.
 * Master switch: socialWaNotify
 * Per-event: socialWaNotifyFollows / Likes / Offers
 */
function parseNotifyFlag(value) {
  if (value === undefined) return undefined;
  return !(value === false || value === "false" || value === 0 || value === "0");
}

function mapNotifyPrefsRow(row) {
  return {
    userId: Number(row.id),
    socialWaNotify: row.social_wa_notify !== false,
    socialWaNotifyFollows: row.social_wa_notify_follows !== false,
    socialWaNotifyLikes: row.social_wa_notify_likes !== false,
    socialWaNotifyOffers: row.social_wa_notify_offers !== false,
  };
}

export async function getUserNotifyPrefs({ userId } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const uid = parseUserId(userId);
  if (!uid) {
    return { error: "invalid_user", message: "Valid userId is required." };
  }
  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }
  const { rows } = await query(
    `SELECT
       id,
       social_wa_notify,
       social_wa_notify_follows,
       social_wa_notify_likes,
       social_wa_notify_offers
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [uid]
  );
  const row = rows[0];
  if (!row) {
    return { error: "user_not_found", message: "User not found." };
  }
  return mapNotifyPrefsRow(row);
}

export async function updateUserNotifyPrefs({
  userId,
  socialWaNotify,
  socialWaNotifyFollows,
  socialWaNotifyLikes,
  socialWaNotifyOffers,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const uid = parseUserId(userId);
  if (!uid) {
    return { error: "invalid_user", message: "Valid userId is required." };
  }
  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }

  const master = parseNotifyFlag(socialWaNotify);
  const follows = parseNotifyFlag(socialWaNotifyFollows);
  const likes = parseNotifyFlag(socialWaNotifyLikes);
  const offers = parseNotifyFlag(socialWaNotifyOffers);

  if (master === undefined && follows === undefined && likes === undefined && offers === undefined) {
    return {
      error: "invalid_request",
      message: "Provide at least one notify preference field.",
    };
  }

  const sets = [];
  const params = [];
  function pushSet(column, value) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (master !== undefined) pushSet("social_wa_notify", master);
  if (follows !== undefined) pushSet("social_wa_notify_follows", follows);
  if (likes !== undefined) pushSet("social_wa_notify_likes", likes);
  if (offers !== undefined) pushSet("social_wa_notify_offers", offers);
  params.push(uid);

  const { rows } = await query(
    `UPDATE users
        SET ${sets.join(", ")}
      WHERE id = $${params.length}
      RETURNING
        id,
        social_wa_notify,
        social_wa_notify_follows,
        social_wa_notify_likes,
        social_wa_notify_offers`,
    params
  );

  const prefs = mapNotifyPrefsRow(rows[0]);
  return {
    ...prefs,
    message: prefs.socialWaNotify
      ? "WhatsApp social ping preferences saved."
      : "All WhatsApp social pings are muted.",
  };
}

/**
 * Recent social activity for a seller storefront: new followers + likes on their products.
 */
export async function listSellerSocialActivity({ sellerUserId, limit = 30 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(sellerUserId);
  if (!uid) {
    return { error: "invalid_user", message: "Valid sellerUserId is required." };
  }
  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);

  const { rows } = await query(
    `SELECT * FROM (
       SELECT
         'follow'::text AS type,
         f.created_at AS created_at,
         f.follower_user_id AS actor_user_id,
         actor.handle AS actor_handle,
         actor.shop_name AS actor_shop_name,
         actor.display_name AS actor_display_name,
         NULL::varchar AS product_id,
         NULL::varchar AS product_title
       FROM follows f
       INNER JOIN users actor ON actor.id = f.follower_user_id
       WHERE f.following_user_id = $1

       UNION ALL

       SELECT
         'like'::text AS type,
         pl.created_at AS created_at,
         pl.user_id AS actor_user_id,
         actor.handle AS actor_handle,
         actor.shop_name AS actor_shop_name,
         actor.display_name AS actor_display_name,
         p.id AS product_id,
         p.title AS product_title
       FROM product_likes pl
       INNER JOIN products p ON p.id = pl.product_id
       INNER JOIN users actor ON actor.id = pl.user_id
       WHERE p.seller_user_id = $1
     ) activity
     ORDER BY created_at DESC
     LIMIT $2`,
    [uid, safeLimit]
  );

  return {
    sellerUserId: uid,
    events: rows.map((row) => {
      const handle = formatHandle(row.actor_handle, "");
      return {
        type: row.type,
        createdAt: row.created_at,
        actor: {
          userId: Number(row.actor_user_id),
          handle: handle || null,
          shopName:
            row.actor_shop_name ||
            row.actor_display_name ||
            (handle ? handle.slice(1) : `User ${row.actor_user_id}`),
        },
        product: row.product_id
          ? {
              id: row.product_id,
              title: row.product_title || row.product_id,
            }
          : null,
      };
    }),
  };
}

/**
 * Buyer activity center: offer responses, shops followed, items liked.
 */
export async function listBuyerSocialActivity({ buyerUserId, limit = 40 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(buyerUserId);
  if (!uid) {
    return { error: "invalid_user", message: "Valid buyerUserId is required." };
  }
  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);

  let rows;
  try {
    const result = await query(
      `SELECT * FROM (
       SELECT
         CASE
           WHEN o.status = 'accepted' THEN 'offer_accepted'
           WHEN o.status = 'declined' THEN 'offer_declined'
           ELSE 'offer_expired'
         END::text AS type,
         COALESCE(o.updated_at, o.created_at) AS created_at,
         o.seller_user_id AS peer_user_id,
         seller.handle AS peer_handle,
         seller.shop_name AS peer_shop_name,
         seller.display_name AS peer_display_name,
         o.product_id AS product_id,
         p.title AS product_title,
         o.id::text AS offer_id,
         o.amount_kes AS amount_kes,
         o.status::text AS offer_status
       FROM offers o
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN users seller ON seller.id = o.seller_user_id
       WHERE o.buyer_user_id = $1
         AND o.status IN ('accepted', 'declined', 'expired')

       UNION ALL

       SELECT
         'follow'::text AS type,
         f.created_at AS created_at,
         f.following_user_id AS peer_user_id,
         shop.handle AS peer_handle,
         shop.shop_name AS peer_shop_name,
         shop.display_name AS peer_display_name,
         NULL::varchar AS product_id,
         NULL::varchar AS product_title,
         NULL::text AS offer_id,
         NULL::numeric AS amount_kes,
         NULL::text AS offer_status
       FROM follows f
       INNER JOIN users shop ON shop.id = f.following_user_id
       WHERE f.follower_user_id = $1

       UNION ALL

       SELECT
         'like'::text AS type,
         pl.created_at AS created_at,
         p.seller_user_id AS peer_user_id,
         seller.handle AS peer_handle,
         seller.shop_name AS peer_shop_name,
         seller.display_name AS peer_display_name,
         pl.product_id AS product_id,
         p.title AS product_title,
         NULL::text AS offer_id,
         NULL::numeric AS amount_kes,
         NULL::text AS offer_status
       FROM product_likes pl
       INNER JOIN products p ON p.id = pl.product_id
       LEFT JOIN users seller ON seller.id = p.seller_user_id
       WHERE pl.user_id = $1
     ) activity
     ORDER BY created_at DESC
     LIMIT $2`,
      [uid, safeLimit]
    );
    rows = result.rows;
  } catch (err) {
    console.error("[social] listBuyerSocialActivity failed:", err.message);
    return {
      error: "buyer_activity_failed",
      message: "Could not load activity right now. Please try again.",
    };
  }

  return {
    buyerUserId: uid,
    events: rows.map((row) => {
      const handle = formatHandle(row.peer_handle, "");
      return {
        type: row.type,
        createdAt: row.created_at,
        peer: row.peer_user_id
          ? {
              userId: Number(row.peer_user_id),
              handle: handle || null,
              shopName:
                row.peer_shop_name ||
                row.peer_display_name ||
                (handle ? handle.slice(1) : `Shop ${row.peer_user_id}`),
            }
          : null,
        product: row.product_id
          ? {
              id: row.product_id,
              title: row.product_title || row.product_id,
            }
          : null,
        offer: row.offer_id
          ? {
              id: Number(row.offer_id),
              status: row.offer_status || null,
              amountKsh: row.amount_kes != null ? Number(row.amount_kes) : null,
            }
          : null,
      };
    }),
  };
}

export async function toggleFollow({ followerUserId, followingUserId } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const followerId = parseUserId(followerUserId);
  const targetId = parseUserId(followingUserId);
  if (!followerId || !targetId) {
    return { error: "invalid_request", message: "followerUserId and followingUserId are required." };
  }
  if (followerId === targetId) {
    return { error: "cannot_follow_self", message: "You cannot follow yourself." };
  }

  if (!(await userExists(followerId))) {
    return { error: "follower_not_found", message: "Follower user not found." };
  }
  if (!(await userExists(targetId))) {
    return { error: "following_not_found", message: "Target user not found." };
  }

  const existing = await query(
    `SELECT id FROM follows WHERE follower_user_id = $1 AND following_user_id = $2 LIMIT 1`,
    [followerId, targetId]
  );

  let following = false;
  let created = false;
  if (existing.rows[0]) {
    await query(`DELETE FROM follows WHERE id = $1`, [existing.rows[0].id]);
  } else {
    await query(
      `INSERT INTO follows (follower_user_id, following_user_id) VALUES ($1, $2)`,
      [followerId, targetId]
    );
    following = true;
    created = true;
  }

  const stats = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM follows WHERE following_user_id = $1) AS followers_count,
      (SELECT COUNT(*)::int FROM follows WHERE follower_user_id = $1) AS following_count`,
    [targetId]
  );

  return {
    following,
    created,
    followerUserId: followerId,
    followingUserId: targetId,
    targetStats: {
      followersCount: Number(stats.rows[0]?.followers_count || 0),
      followingCount: Number(stats.rows[0]?.following_count || 0),
    },
  };
}

export async function getUserSocialStats(userId) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(userId);
  if (!uid) {
    return { error: "invalid_user", message: "Valid userId is required." };
  }
  if (!(await userExists(uid))) {
    return { error: "user_not_found", message: "User not found." };
  }

  const { rows } = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM follows WHERE following_user_id = $1) AS followers_count,
      (SELECT COUNT(*)::int FROM follows WHERE follower_user_id = $1) AS following_count,
      (SELECT COUNT(*)::int FROM products WHERE seller_user_id = $1 AND in_stock = TRUE AND is_sold = FALSE) AS active_listings_count,
      (SELECT COUNT(*)::int
         FROM product_likes pl
         INNER JOIN products p ON p.id = pl.product_id
        WHERE p.seller_user_id = $1) AS likes_received_count,
      (SELECT COALESCE(AVG(rating), 0)::numeric(10,2) FROM order_reviews WHERE seller_user_id = $1) AS avg_rating,
      (SELECT COUNT(*)::int FROM order_reviews WHERE seller_user_id = $1) AS total_reviews`,
    [uid]
  );

  const row = rows[0] || {};
  return {
    userId: uid,
    followersCount: Number(row.followers_count || 0),
    followingCount: Number(row.following_count || 0),
    activeListingsCount: Number(row.active_listings_count || 0),
    likesReceivedCount: Number(row.likes_received_count || 0),
    avgRating: Number(row.avg_rating || 0),
    totalReviews: Number(row.total_reviews || 0),
  };
}

async function getViewerShopState({ viewerUserId, shopUserId, productIds = [] } = {}) {
  const uid = parseUserId(viewerUserId);
  if (!uid) return null;
  if (!(await userExists(uid))) return null;

  const targetId = parseUserId(shopUserId);
  let isFollowing = false;
  if (targetId && targetId !== uid) {
    const existing = await query(
      `SELECT id FROM follows WHERE follower_user_id = $1 AND following_user_id = $2 LIMIT 1`,
      [uid, targetId]
    );
    isFollowing = Boolean(existing.rows[0]);
  }

  const ids = (Array.isArray(productIds) ? productIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  let likedProductIds = [];
  if (ids.length) {
    const { rows } = await query(
      `SELECT product_id
         FROM product_likes
        WHERE user_id = $1
          AND product_id = ANY($2::text[])`,
      [uid, ids]
    );
    likedProductIds = rows.map((row) => String(row.product_id));
  }

  return {
    userId: uid,
    isFollowing,
    likedProductIds,
  };
}

async function attachViewerToShopProfile(profile, viewerUserId) {
  if (!profile || profile.error) return profile;
  const viewer = await getViewerShopState({
    viewerUserId,
    shopUserId: profile?.shop?.userId,
    productIds: (profile.products || []).map((item) => item.id),
  });
  if (!viewer) return profile;

  const likedSet = new Set(viewer.likedProductIds);
  return {
    ...profile,
    viewer,
    products: (profile.products || []).map((item) => ({
      ...item,
      liked: likedSet.has(String(item.id)),
    })),
  };
}

export async function getShopProfileByHandle({
  handle,
  limit = 24,
  offset = 0,
  viewerUserId = null,
  tab = "active",
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const cleanHandle = normalizeHandle(handle);
  if (!cleanHandle) {
    return { error: "invalid_handle", message: "A valid shop handle is required." };
  }
  const listingTab = String(tab || "active").toLowerCase() === "sold" ? "sold" : "active";

  const userResult = await query(
    `SELECT
       id,
       phone,
       email,
       handle,
       display_name,
       shop_name,
       bio,
       avatar_url,
       location,
       instagram_url,
       tiktok_url,
       role,
       is_seller_verified
     FROM users
     WHERE LOWER(handle) = $1 OR LOWER(handle) = $2
     LIMIT 1`,
    [cleanHandle, `@${cleanHandle}`]
  );
  const user = userResult.rows[0] || null;

  if (user) {
    const linkedSellerResult = await query(
      `SELECT id, business_name, slug, city, bio, is_verified
         FROM sellers
        WHERE user_id = $1
        LIMIT 1`,
      [user.id]
    );
    const linkedSeller = linkedSellerResult.rows[0] || null;
    const activeStorefront = await listStorefrontProducts({
      sellerUserId: user.id,
      sellerId: linkedSeller?.id || null,
      limit,
      offset,
      status: "active",
    });
    const soldStorefront = await listStorefrontProducts({
      sellerUserId: user.id,
      sellerId: linkedSeller?.id || null,
      limit: listingTab === "sold" ? limit : 1,
      offset: listingTab === "sold" ? offset : 0,
      status: "sold",
    });
    const storefront = listingTab === "sold" ? soldStorefront : activeStorefront;
    const likesReceived = await getLikesReceivedForOwner({
      sellerUserId: user.id,
      sellerId: linkedSeller?.id || null,
    });
    const follows = await getFollowCounts(user.id);
    const reviewSummary = await getReviewSummary(user.id);
    const sellerMetrics = await getSellerStorefrontMetrics({
      sellerUserId: user.id,
      sellerId: linkedSeller?.id || null,
    });

    return attachViewerToShopProfile(
      {
        shop: {
          userId: Number(user.id),
          sellerId: linkedSeller?.id != null ? Number(linkedSeller.id) : null,
          handle: formatHandle(user.handle, cleanHandle),
          shopName:
            user.shop_name ||
            linkedSeller?.business_name ||
            user.display_name ||
            `Shop ${user.id}`,
          bio: user.bio || linkedSeller?.bio || null,
          avatarUrl: user.avatar_url || null,
          location: user.location || linkedSeller?.city || null,
          instagramUrl: user.instagram_url || null,
          tiktokUrl: user.tiktok_url || null,
          isSellerVerified: Boolean(user.is_seller_verified || linkedSeller?.is_verified),
          role: user.role || "seller",
          source: linkedSeller ? "user_linked_seller" : "user",
        },
        stats: {
          listingsCount: activeStorefront.count,
          soldCount: soldStorefront.count,
          salesCount: sellerMetrics.salesCount,
          avgDispatchHours: sellerMetrics.avgDispatchHours,
          followersCount: follows.followersCount,
          followingCount: follows.followingCount,
          likesReceivedCount: likesReceived,
          avgRating: reviewSummary.avgRating,
          totalReviews: reviewSummary.totalReviews,
        },
        tab: listingTab,
        products: storefront.products,
        pagination: { limit: storefront.limit, offset: storefront.offset, total: storefront.count },
      },
      viewerUserId
    );
  }

  const sellerResult = await query(
    `SELECT
       s.id,
       s.user_id,
       s.business_name,
       s.slug,
       s.city,
       s.bio,
       s.is_verified
     FROM sellers s
     WHERE LOWER(s.slug) = $1
     LIMIT 1`,
    [cleanHandle]
  );
  const seller = sellerResult.rows[0] || null;
  if (!seller) {
    return { error: "shop_not_found", message: "Shop handle not found." };
  }

  let sellerUser = null;
  if (seller.user_id != null) {
    const sellerUserResult = await query(
      `SELECT
         id,
         handle,
         display_name,
         shop_name,
         bio,
         avatar_url,
         location,
         instagram_url,
         tiktok_url,
         role,
         is_seller_verified
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [seller.user_id]
    );
    sellerUser = sellerUserResult.rows[0] || null;
  }

  const activeStorefront = await listStorefrontProducts({
    sellerUserId: sellerUser?.id || null,
    sellerId: seller.id,
    limit,
    offset,
    status: "active",
  });
  const soldStorefront = await listStorefrontProducts({
    sellerUserId: sellerUser?.id || null,
    sellerId: seller.id,
    limit: listingTab === "sold" ? limit : 1,
    offset: listingTab === "sold" ? offset : 0,
    status: "sold",
  });
  const storefront = listingTab === "sold" ? soldStorefront : activeStorefront;
  const likesReceived = await getLikesReceivedForOwner({
    sellerUserId: sellerUser?.id || null,
    sellerId: seller.id,
  });
  const follows = await getFollowCounts(sellerUser?.id || null);
  const reviewSummary = await getReviewSummary(sellerUser?.id || null);
  const sellerMetrics = await getSellerStorefrontMetrics({
    sellerUserId: sellerUser?.id || null,
    sellerId: seller.id,
  });

  return attachViewerToShopProfile(
    {
      shop: {
        userId: sellerUser?.id != null ? Number(sellerUser.id) : null,
        sellerId: Number(seller.id),
        handle: formatHandle(sellerUser?.handle, seller.slug),
        shopName:
          sellerUser?.shop_name ||
          seller.business_name ||
          sellerUser?.display_name ||
          `Shop ${seller.id}`,
        bio: sellerUser?.bio || seller.bio || null,
        avatarUrl: sellerUser?.avatar_url || null,
        location: sellerUser?.location || seller.city || null,
        instagramUrl: sellerUser?.instagram_url || null,
        tiktokUrl: sellerUser?.tiktok_url || null,
        isSellerVerified: Boolean(sellerUser?.is_seller_verified || seller.is_verified),
        role: sellerUser?.role || "seller",
        source: sellerUser ? "seller_linked_user" : "seller",
      },
      stats: {
        listingsCount: activeStorefront.count,
        soldCount: soldStorefront.count,
        salesCount: sellerMetrics.salesCount,
        avgDispatchHours: sellerMetrics.avgDispatchHours,
        followersCount: follows.followersCount,
        followingCount: follows.followingCount,
        likesReceivedCount: likesReceived,
        avgRating: reviewSummary.avgRating,
        totalReviews: reviewSummary.totalReviews,
      },
      tab: listingTab,
      products: storefront.products,
      pagination: { limit: storefront.limit, offset: storefront.offset, total: storefront.count },
    },
    viewerUserId
  );
}

function hasForbiddenMessage(content) {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(content));
}

function mapStorefrontProductRow(row) {
  const condition = row.condition || null;
  const imageUrl = resolveStorefrontImageUrl({
    id: row.id,
    imageUrl: row.image_url || row.primary_image_url || null,
  });
  return {
    id: row.id,
    title: row.title,
    description: row.description || null,
    priceKsh: row.price_kes != null ? Number(row.price_kes) : null,
    priceKes: row.price_kes != null ? Number(row.price_kes) : null,
    imageUrl,
    category: row.category,
    subCategory: row.sub_category || null,
    size: row.size_label || null,
    pitToPitIn: row.pit_to_pit_in != null ? Number(row.pit_to_pit_in) : null,
    lengthIn: row.length_in != null ? Number(row.length_in) : null,
    waistIn: row.waist_in != null ? Number(row.waist_in) : null,
    condition,
    conditionLabel: CONDITION_LABELS[condition] || (condition ? String(condition).replace(/_/g, " ") : null),
    brand: row.brand || null,
    genderFit: row.gender_fit || null,
    isSecondhand: Boolean(row.is_secondhand),
    isSold: Boolean(row.is_sold),
    likesCount: Number(row.likes_count || 0),
    createdAt: row.created_at,
  };
}

async function listStorefrontProducts({
  sellerUserId = null,
  sellerId = null,
  limit = 24,
  offset = 0,
  status = "active",
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const listingStatus = String(status || "active").toLowerCase() === "sold" ? "sold" : "active";

  const ownerParams = [];
  const ownerClauses = [];
  if (sellerUserId != null) {
    ownerParams.push(Number(sellerUserId));
    ownerClauses.push(`p.seller_user_id = $${ownerParams.length}`);
  }
  if (sellerId != null) {
    ownerParams.push(Number(sellerId));
    ownerClauses.push(`p.seller_id = $${ownerParams.length}`);
  }
  if (!ownerClauses.length) {
    return { products: [], count: 0, limit: safeLimit, offset: safeOffset, status: listingStatus };
  }

  const whereOwner = `(${ownerClauses.join(" OR ")})`;
  const whereStatus =
    listingStatus === "sold"
      ? `${whereOwner} AND p.is_sold = TRUE`
      : `${whereOwner} AND p.in_stock = TRUE AND p.is_sold = FALSE`;

  const listParams = [...ownerParams, safeLimit, safeOffset];
  const listLimitParam = `$${ownerParams.length + 1}`;
  const listOffsetParam = `$${ownerParams.length + 2}`;

  const { rows } = await query(
    `SELECT
       p.id,
       p.title,
       p.description,
       p.price_kes,
       p.primary_image_url,
       p.category,
       p.sub_category,
       p.size_label,
       p.pit_to_pit_in,
       p.length_in,
       p.waist_in,
       p.condition,
       p.brand,
       p.gender_fit,
       p.is_secondhand,
       p.is_sold,
       p.created_at,
       COALESCE(
         (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order ASC LIMIT 1),
         p.primary_image_url
       ) AS image_url,
       COALESCE(pl.likes_count, 0)::int AS likes_count
     FROM products p
     LEFT JOIN (
       SELECT product_id, COUNT(*)::int AS likes_count
       FROM product_likes
       GROUP BY product_id
     ) pl ON pl.product_id = p.id
     WHERE ${whereStatus}
     ORDER BY p.created_at DESC
     LIMIT ${listLimitParam}
     OFFSET ${listOffsetParam}`,
    listParams
  );

  const countResult = await query(
    `SELECT COUNT(*)::int AS listings_count
       FROM products p
      WHERE ${whereStatus}`,
    ownerParams
  );

  return {
    products: rows.map(mapStorefrontProductRow),
    count: Number(countResult.rows[0]?.listings_count || 0),
    limit: safeLimit,
    offset: safeOffset,
    status: listingStatus,
  };
}

/** @deprecated Prefer listStorefrontProducts({ status: "active" }) */
async function listActiveStorefrontProducts(opts = {}) {
  return listStorefrontProducts({ ...opts, status: "active" });
}

async function getSellerStorefrontMetrics({ sellerUserId = null, sellerId = null } = {}) {
  const ownerParams = [];
  const ownerClauses = [];
  if (sellerUserId != null) {
    ownerParams.push(Number(sellerUserId));
    ownerClauses.push(`p.seller_user_id = $${ownerParams.length}`);
  }
  if (sellerId != null) {
    ownerParams.push(Number(sellerId));
    ownerClauses.push(`p.seller_id = $${ownerParams.length}`);
  }
  if (!ownerClauses.length) {
    return { salesCount: 0, avgDispatchHours: null };
  }

  const whereOwner = `(${ownerClauses.join(" OR ")})`;
  let salesCount = 0;
  try {
    const sold = await query(
      `SELECT COUNT(*)::int AS n FROM products p WHERE ${whereOwner} AND p.is_sold = TRUE`,
      ownerParams
    );
    salesCount = Number(sold.rows[0]?.n || 0);
  } catch {
    salesCount = 0;
  }

  let avgDispatchHours = null;
  if (sellerId != null) {
    try {
      const dispatch = await query(
        `SELECT AVG(EXTRACT(EPOCH FROM (s.dispatched_at - s.created_at)) / 3600.0) AS avg_hours
           FROM shipments s
          WHERE s.seller_id = $1
            AND s.dispatched_at IS NOT NULL
            AND s.created_at IS NOT NULL`,
        [Number(sellerId)]
      );
      const raw = dispatch.rows[0]?.avg_hours;
      if (raw != null && Number.isFinite(Number(raw))) {
        avgDispatchHours = Math.round(Number(raw) * 10) / 10;
      }
    } catch {
      avgDispatchHours = null;
    }
  }

  return { salesCount, avgDispatchHours };
}

async function getLikesReceivedForOwner({ sellerUserId = null, sellerId = null } = {}) {
  const ownerParams = [];
  const ownerClauses = [];
  if (sellerUserId != null) {
    ownerParams.push(Number(sellerUserId));
    ownerClauses.push(`p.seller_user_id = $${ownerParams.length}`);
  }
  if (sellerId != null) {
    ownerParams.push(Number(sellerId));
    ownerClauses.push(`p.seller_id = $${ownerParams.length}`);
  }
  if (!ownerClauses.length) return 0;

  const { rows } = await query(
    `SELECT COUNT(*)::int AS likes_received_count
       FROM product_likes pl
       INNER JOIN products p ON p.id = pl.product_id
      WHERE ${ownerClauses.map((c) => `(${c})`).join(" OR ")}`,
    ownerParams
  );
  return Number(rows[0]?.likes_received_count || 0);
}

async function getFollowCounts(userId = null) {
  if (!userId) return { followersCount: 0, followingCount: 0 };
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM follows WHERE following_user_id = $1) AS followers_count,
       (SELECT COUNT(*)::int FROM follows WHERE follower_user_id = $1) AS following_count`,
    [Number(userId)]
  );
  return {
    followersCount: Number(rows[0]?.followers_count || 0),
    followingCount: Number(rows[0]?.following_count || 0),
  };
}

async function getReviewSummary(userId = null) {
  if (!userId) return { avgRating: 0, totalReviews: 0 };
  const { rows } = await query(
    `SELECT
       COALESCE(AVG(rating), 0)::numeric(10,2) AS avg_rating,
       COUNT(*)::int AS total_reviews
     FROM order_reviews
     WHERE seller_user_id = $1
       AND direction = 'buyer_to_seller'`,
    [Number(userId)]
  );
  return {
    avgRating: Number(rows[0]?.avg_rating || 0),
    totalReviews: Number(rows[0]?.total_reviews || 0),
  };
}

async function getBuyerReviewSummary(userId = null) {
  if (!userId) return { avgRating: 0, totalReviews: 0 };
  const { rows } = await query(
    `SELECT
       COALESCE(AVG(rating), 0)::numeric(10,2) AS avg_rating,
       COUNT(*)::int AS total_reviews
     FROM order_reviews
     WHERE buyer_user_id = $1
       AND direction = 'seller_to_buyer'`,
    [Number(userId)]
  );
  return {
    avgRating: Number(rows[0]?.avg_rating || 0),
    totalReviews: Number(rows[0]?.total_reviews || 0),
  };
}

function mapOfferRow(row) {
  const shippingKes =
    row.product_shipping_kes != null ? Math.round(Number(row.product_shipping_kes) || 0) : null;
  const rawBreakdown =
    shippingKes != null ? resolveOfferBreakdown(row.amount_kes, shippingKes) : null;
  const breakdown = serializeOfferBreakdown(rawBreakdown);
  const breakdownError = offerBreakdownError(rawBreakdown);

  return {
    id: Number(row.id),
    productId: row.product_id,
    buyerUserId: Number(row.buyer_user_id),
    sellerUserId: Number(row.seller_user_id),
    /** Negotiated buyer all-in (same semantics as listing price_kes). */
    amountKsh: Number(row.amount_kes),
    status: row.status,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    /** Escrow split at current listing shipping: buyer pays total → seller net + shipping + fee. */
    breakdown,
    breakdownError,
    product: {
      id: row.product_id,
      title: row.product_title || null,
      priceKsh: row.product_price_kes != null ? Number(row.product_price_kes) : null,
      shippingKsh: shippingKes,
      imageUrl: row.product_image_url || null,
    },
    buyer: {
      id: Number(row.buyer_user_id),
      handle: row.buyer_handle ? formatHandle(row.buyer_handle) : null,
      shopName: row.buyer_shop_name || null,
    },
    seller: {
      id: Number(row.seller_user_id),
      handle: row.seller_handle ? formatHandle(row.seller_handle) : null,
      shopName: row.seller_shop_name || null,
    },
  };
}

function mapHandledQueueRow(row) {
  return {
    offerId: Number(row.offer_id),
    sellerUserId: Number(row.seller_user_id),
    handled: true,
    handledAt: row.handled_at || null,
    updatedAt: row.updated_at || row.handled_at || null,
  };
}

function mapHandledQueueEventRow(row) {
  return {
    id: Number(row.id),
    offerId: Number(row.offer_id),
    sellerUserId: Number(row.seller_user_id),
    action: String(row.action || "").trim().toLowerCase(),
    source: row.source || "seller_dashboard",
    createdAt: row.created_at || null,
  };
}

export async function createOffer({
  productId,
  buyerUserId,
  sellerUserId,
  amountKsh,
  expiresInHours = 24,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const product = String(productId || "").trim();
  const buyerId = parseUserId(buyerUserId);
  const sellerId = parseUserId(sellerUserId);
  const amount = Number(amountKsh);
  const expiryHours = Math.min(Math.max(Number(expiresInHours) || 24, 1), 168);

  if (!product || !buyerId || !sellerId || !Number.isFinite(amount) || amount <= 0) {
    return {
      error: "invalid_offer_payload",
      message: "productId, buyerUserId, sellerUserId and positive amountKsh are required.",
    };
  }
  if (buyerId === sellerId) {
    return { error: "invalid_offer_payload", message: "Buyer and seller cannot be the same user." };
  }
  if (!(await userExists(buyerId))) {
    return { error: "buyer_not_found", message: "Buyer user not found." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const productRow = await query(
    `SELECT id, seller_user_id, price_kes, shipping_kes, in_stock, is_sold FROM products WHERE id = $1 LIMIT 1`,
    [product]
  );
  const productData = productRow.rows[0];
  if (!productData) {
    return { error: "product_not_found", message: "Product not found." };
  }
  if (productData.seller_user_id != null && Number(productData.seller_user_id) !== sellerId) {
    return {
      error: "seller_mismatch",
      message: "Offer seller does not match this product owner.",
    };
  }
  if (productData.in_stock === false || productData.is_sold === true) {
    return {
      error: "product_unavailable",
      message: "This product is no longer available for offers.",
    };
  }
  if (productData.price_kes != null && amount > Number(productData.price_kes)) {
    return {
      error: "offer_above_price",
      message: "Offer amount cannot exceed listed product price.",
    };
  }

  // amountKsh is buyer all-in (escrow total). Must cover listing shipping + 10% fee.
  const shippingKes = Math.round(Number(productData.shipping_kes) || 0);
  const feeBreakdown = resolveOfferBreakdown(amount, shippingKes);
  const feeErr = offerBreakdownError(feeBreakdown);
  if (feeErr) return feeErr;

  await expirePendingOffers();

  const existing = await query(
    `SELECT id
       FROM offers
      WHERE product_id = $1
        AND buyer_user_id = $2
        AND seller_user_id = $3
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1`,
    [product, buyerId, sellerId]
  );

  let offerId = null;
  if (existing.rows[0]) {
    offerId = Number(existing.rows[0].id);
    await query(
      `UPDATE offers
          SET amount_kes = $2,
              expires_at = NOW() + ($3 || ' hours')::interval,
              updated_at = NOW()
        WHERE id = $1`,
      [offerId, amount, String(expiryHours)]
    );
  } else {
    const inserted = await query(
      `INSERT INTO offers (product_id, buyer_user_id, seller_user_id, amount_kes, status, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW() + ($5 || ' hours')::interval)
       RETURNING id`,
      [product, buyerId, sellerId, amount, String(expiryHours)]
    );
    offerId = Number(inserted.rows[0].id);
  }

  const hydrated = await query(
    `SELECT
       o.*,
       ${OFFER_PRODUCT_SELECT},
       buyer.handle AS buyer_handle,
       buyer.shop_name AS buyer_shop_name,
       seller.handle AS seller_handle,
       seller.shop_name AS seller_shop_name
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
     LEFT JOIN users seller ON seller.id = o.seller_user_id
     WHERE o.id = $1
     LIMIT 1`,
    [offerId]
  );

  const mapped = mapOfferRow(hydrated.rows[0]);
  return {
    success: true,
    offer: mapped,
    breakdown: mapped.breakdown,
  };
}

export async function respondToOffer({ offerId, sellerUserId, action, amountKsh } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const oid = parseOfferId(offerId);
  const sellerId = parseUserId(sellerUserId);
  const normalizedAction = String(action || "")
    .trim()
    .toLowerCase();
  // "countered" locks a middle buyer-total and accepts it for checkout (no schema change).
  if (!oid || !sellerId || !["accepted", "declined", "countered"].includes(normalizedAction)) {
    return {
      error: "invalid_offer_action",
      message: "offerId, sellerUserId, and action (accepted|declined|countered) are required.",
    };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  await expirePendingOffers();

  const current = await query(`SELECT * FROM offers WHERE id = $1 LIMIT 1`, [oid]);
  const offer = current.rows[0];
  if (!offer) {
    return { error: "offer_not_found", message: "Offer not found." };
  }
  if (Number(offer.seller_user_id) !== sellerId) {
    return { error: "forbidden_offer_action", message: "Only the seller can respond to this offer." };
  }
  if (!OFFER_STATUSES.has(offer.status) || offer.status !== "pending") {
    return {
      error: "offer_not_pending",
      message: `Offer is already ${offer.status}.`,
    };
  }
  if (offer.expires_at && new Date(offer.expires_at).getTime() <= Date.now()) {
    await query(`UPDATE offers SET status = 'expired', updated_at = NOW() WHERE id = $1`, [oid]);
    return { error: "offer_expired", message: "Offer has expired." };
  }

  const productRow = await query(
    `SELECT price_kes, shipping_kes, in_stock, is_sold FROM products WHERE id = $1 LIMIT 1`,
    [offer.product_id]
  );
  const productData = productRow.rows[0];

  let nextAmount = Math.round(Number(offer.amount_kes) || 0);
  let persistedStatus = normalizedAction;
  let wasCountered = false;

  if (normalizedAction === "countered") {
    const counterAmount = Math.round(Number(amountKsh));
    const listed =
      productData?.price_kes != null ? Math.round(Number(productData.price_kes)) : null;
    const buyerOffer = Math.round(Number(offer.amount_kes) || 0);
    if (!Number.isFinite(counterAmount) || counterAmount < 1) {
      return {
        error: "invalid_counter_amount",
        message: "Enter a counter offer amount in KES (buyer all-in total).",
      };
    }
    if (counterAmount <= buyerOffer) {
      return {
        error: "counter_not_higher",
        message: `Counter must be above the buyer's offer (${buyerOffer.toLocaleString("en-KE")} KES). Accept their offer instead if you agree.`,
      };
    }
    if (listed != null && counterAmount > listed) {
      return {
        error: "offer_above_list",
        message: "Counter cannot exceed the listed buyer price.",
      };
    }
    nextAmount = counterAmount;
    persistedStatus = "accepted";
    wasCountered = true;
  }

  // Block accepting / countering offers that cannot fund escrow.
  if (persistedStatus === "accepted") {
    if (!productData || productData.in_stock === false || productData.is_sold === true) {
      return {
        error: "product_unavailable",
        message: "This product is no longer available for offers.",
      };
    }
    if (productData.price_kes != null && nextAmount > Number(productData.price_kes)) {
      return {
        error: "offer_above_list",
        message: "Agreed offer cannot exceed the listed buyer price.",
      };
    }
    const shippingKes = Math.round(Number(productData.shipping_kes) || 0);
    const feeBreakdown = resolveOfferBreakdown(nextAmount, shippingKes);
    const feeErr = offerBreakdownError(feeBreakdown);
    if (feeErr) {
      return {
        ...feeErr,
        message:
          feeErr.message ||
          "This offer is too low to cover shipping and Sokoni's fee. Ask the buyer for a higher amount.",
      };
    }
  }

  const expiresSql =
    persistedStatus === "accepted"
      ? `NOW() + INTERVAL '24 hours'`
      : `expires_at`;
  await query(
    `UPDATE offers
        SET status = $2,
            amount_kes = $3,
            expires_at = ${expiresSql},
            updated_at = NOW()
      WHERE id = $1`,
    [oid, persistedStatus, nextAmount]
  );

  const hydrated = await query(
    `SELECT
       o.*,
       ${OFFER_PRODUCT_SELECT},
       buyer.handle AS buyer_handle,
       buyer.shop_name AS buyer_shop_name,
       seller.handle AS seller_handle,
       seller.shop_name AS seller_shop_name
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
     LEFT JOIN users seller ON seller.id = o.seller_user_id
     WHERE o.id = $1
     LIMIT 1`,
    [oid]
  );

  const mapped = mapOfferRow(hydrated.rows[0]);
  return {
    success: true,
    offer: mapped,
    breakdown: mapped.breakdown,
    countered: wasCountered,
  };
}

export async function sendOfferReminder({ offerId, sellerUserId, cooldownSeconds } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const oid = parseOfferId(offerId);
  const sellerId = parseUserId(sellerUserId);
  const cooldownSec = parseCooldownSeconds(cooldownSeconds);
  const cooldownMs = cooldownSec * 1000;
  if (!oid || !sellerId) {
    return {
      error: "invalid_offer_action",
      message: "offerId and sellerUserId are required.",
    };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  await expirePendingOffers();

  const offerResult = await query(
    `SELECT
       o.*,
       p.title AS product_title
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     WHERE o.id = $1
     LIMIT 1`,
    [oid]
  );
  const offer = offerResult.rows[0];
  if (!offer) {
    return { error: "offer_not_found", message: "Offer not found." };
  }
  if (Number(offer.seller_user_id) !== sellerId) {
    return { error: "forbidden_offer_action", message: "Only the seller can send reminders for this offer." };
  }

  const status = String(offer.status || "")
    .trim()
    .toLowerCase();
  if (status !== "accepted") {
    return {
      error: "offer_not_accepted",
      message: `Offer is ${status || "not accepted"} and cannot be reminded.`,
    };
  }
  if (offer.expires_at && new Date(offer.expires_at).getTime() <= Date.now()) {
    await query(`UPDATE offers SET status = 'expired', updated_at = NOW() WHERE id = $1`, [oid]);
    return { error: "offer_expired", message: "Offer has expired." };
  }

  const buyerId = parseUserId(offer.buyer_user_id);
  if (!buyerId || buyerId === sellerId) {
    return {
      error: "invalid_offer_action",
      message: "Could not resolve buyer profile for this offer reminder.",
    };
  }

  const reminderRow = await query(
    `SELECT created_at
       FROM offer_reminders
      WHERE offer_id = $1
        AND seller_user_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [oid, sellerId]
  );
  const lastReminderAtRaw = reminderRow.rows[0]?.created_at || null;
  const lastReminderMs = lastReminderAtRaw ? new Date(lastReminderAtRaw).getTime() : 0;
  const nowMs = Date.now();
  const cooldownMsRemaining = Math.max(0, lastReminderMs + cooldownMs - nowMs);
  if (cooldownMsRemaining > 0) {
    return {
      error: "reminder_cooldown_active",
      message: `Reminder already sent. Try again in ${Math.ceil(cooldownMsRemaining / 1000)}s.`,
      cooldownMsRemaining,
      cooldownSecondsRemaining: Math.ceil(cooldownMsRemaining / 1000),
      lastReminderAt: new Date(lastReminderMs).toISOString(),
      cooldownEndsAt: new Date(lastReminderMs + cooldownMs).toISOString(),
    };
  }

  const messageResult = await sendDirectMessage({
    senderUserId: sellerId,
    receiverUserId: buyerId,
    content: offerReminderMessage(offer),
  });
  if (messageResult.error) return messageResult;

  const messageId = Number(messageResult.message?.id);
  await query(
    `INSERT INTO offer_reminders (offer_id, seller_user_id, buyer_user_id, message_id)
     VALUES ($1, $2, $3, $4)`,
    [oid, sellerId, buyerId, Number.isInteger(messageId) && messageId > 0 ? messageId : null]
  );

  const sentAtMs = Date.now();
  return {
    success: true,
    reminder: {
      offerId: oid,
      sellerUserId: sellerId,
      buyerUserId: buyerId,
      sentAt: new Date(sentAtMs).toISOString(),
      cooldownMs,
      cooldownSeconds: cooldownSec,
      cooldownEndsAt: new Date(sentAtMs + cooldownMs).toISOString(),
      messageId: Number.isInteger(messageId) && messageId > 0 ? messageId : null,
      message: messageResult.message,
    },
  };
}

export async function listSellerHandledOfferQueue({ sellerUserId, offerIds } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const sellerId = parseUserId(sellerUserId);
  if (!sellerId) {
    return { error: "invalid_user", message: "Valid sellerUserId is required." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const requestedOfferIds = parseOfferIdList(offerIds);
  const params = [sellerId];
  let whereSql = `seller_user_id = $1`;
  if (requestedOfferIds.length) {
    params.push(requestedOfferIds);
    whereSql += ` AND offer_id = ANY($2::bigint[])`;
  }

  const { rows } = await query(
    `SELECT offer_id, seller_user_id, handled_at, updated_at
       FROM offer_handled_queue
      WHERE ${whereSql}
      ORDER BY handled_at DESC`,
    params
  );
  const byOfferId = new Map();
  rows.forEach((row) => {
    byOfferId.set(Number(row.offer_id), row);
  });

  const states = requestedOfferIds.length
    ? requestedOfferIds.map((id) => {
        const row = byOfferId.get(id);
        if (!row) {
          return {
            offerId: id,
            sellerUserId: sellerId,
            handled: false,
            handledAt: null,
            updatedAt: null,
          };
        }
        return mapHandledQueueRow(row);
      })
    : rows.map(mapHandledQueueRow);

  return {
    sellerUserId: sellerId,
    states,
    count: states.length,
    handledCount: rows.length,
  };
}

export async function setSellerHandledOfferQueueState({ offerId, sellerUserId, handled, source } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const oid = parseOfferId(offerId);
  const sellerId = parseUserId(sellerUserId);
  const handledFlag = parseHandledFlag(handled);
  const eventSource = normalizeHandledQueueEventSource(source);
  if (!oid || !sellerId || handledFlag == null) {
    return {
      error: "invalid_offer_action",
      message: "offerId, sellerUserId, and handled (true/false) are required.",
    };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  await expirePendingOffers();

  const current = await query(
    `SELECT id, status, expires_at, buyer_user_id, seller_user_id
       FROM offers
      WHERE id = $1
      LIMIT 1`,
    [oid]
  );
  const offer = current.rows[0];
  if (!offer) {
    return { error: "offer_not_found", message: "Offer not found." };
  }
  if (Number(offer.seller_user_id) !== sellerId) {
    return { error: "forbidden_offer_action", message: "Only the seller can update this quick queue state." };
  }

  if (handledFlag) {
    const status = String(offer.status || "")
      .trim()
      .toLowerCase();
    if (status !== "accepted") {
      return {
        error: "offer_not_accepted",
        message: `Offer is ${status || "not accepted"} and cannot be added to handled queue.`,
      };
    }
    if (offer.expires_at && new Date(offer.expires_at).getTime() <= Date.now()) {
      await query(`UPDATE offers SET status = 'expired', updated_at = NOW() WHERE id = $1`, [oid]);
      await query(`DELETE FROM offer_handled_queue WHERE offer_id = $1 AND seller_user_id = $2`, [oid, sellerId]);
      return { error: "offer_expired", message: "Offer has expired." };
    }
    const buyerId = parseUserId(offer.buyer_user_id);
    if (!buyerId || buyerId === sellerId) {
      return {
        error: "invalid_offer_action",
        message: "Could not resolve buyer profile for this handled-offer action.",
      };
    }

    const upserted = await query(
      `INSERT INTO offer_handled_queue (offer_id, seller_user_id, handled_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (offer_id, seller_user_id)
       DO UPDATE SET handled_at = EXCLUDED.handled_at, updated_at = NOW()
       RETURNING offer_id, seller_user_id, handled_at, updated_at`,
      [oid, sellerId]
    );
    await query(
      `INSERT INTO offer_handled_queue_events (offer_id, seller_user_id, action, source)
       VALUES ($1, $2, 'handled', $3)`,
      [oid, sellerId, eventSource]
    );
    return { success: true, state: mapHandledQueueRow(upserted.rows[0]) };
  }

  const removed = await query(`DELETE FROM offer_handled_queue WHERE offer_id = $1 AND seller_user_id = $2 RETURNING offer_id`, [
    oid,
    sellerId,
  ]);
  if (removed.rows[0]) {
    await query(
      `INSERT INTO offer_handled_queue_events (offer_id, seller_user_id, action, source)
       VALUES ($1, $2, 'unhandled', $3)`,
      [oid, sellerId, eventSource]
    );
  }
  return {
    success: true,
    state: {
      offerId: oid,
      sellerUserId: sellerId,
      handled: false,
      handledAt: null,
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function resetSellerHandledOfferQueue({ sellerUserId, source } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const sellerId = parseUserId(sellerUserId);
  const eventSource = normalizeHandledQueueEventSource(source);
  if (!sellerId) {
    return { error: "invalid_user", message: "Valid sellerUserId is required." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const cleared = await query(
    `WITH removed AS (
       DELETE FROM offer_handled_queue
        WHERE seller_user_id = $1
      RETURNING offer_id, seller_user_id
     ),
     logged AS (
       INSERT INTO offer_handled_queue_events (offer_id, seller_user_id, action, source)
       SELECT offer_id, seller_user_id, 'reset', $2
         FROM removed
       RETURNING id
     )
     SELECT COUNT(*)::int AS cleared_count FROM removed`,
    [sellerId, eventSource]
  );
  return {
    success: true,
    sellerUserId: sellerId,
    clearedCount: Number(cleared.rows[0]?.cleared_count || 0),
  };
}

export async function listSellerHandledOfferQueueEvents({
  sellerUserId,
  offerId,
  action,
  limit = DEFAULT_HANDLED_QUEUE_EVENTS_LIMIT,
  offset = 0,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const sellerId = parseUserId(sellerUserId);
  if (!sellerId) {
    return { error: "invalid_user", message: "Valid sellerUserId is required." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const requestedOfferId = offerId == null || offerId === "" ? null : parseOfferId(offerId);
  if (offerId != null && offerId !== "" && !requestedOfferId) {
    return { error: "invalid_offer", message: "Valid offerId is required when provided." };
  }

  const normalizedAction = action == null ? null : String(action).trim().toLowerCase();
  if (normalizedAction && !HANDLED_QUEUE_EVENT_ACTIONS.has(normalizedAction)) {
    return {
      error: "invalid_event_action",
      message: "action must be one of handled, unhandled, or reset.",
    };
  }

  const safeLimit = parseListLimit(limit);
  const safeOffset = parseListOffset(offset);
  const params = [sellerId];
  const whereClauses = [`seller_user_id = $1`];
  if (requestedOfferId) {
    params.push(requestedOfferId);
    whereClauses.push(`offer_id = $${params.length}`);
  }
  if (normalizedAction) {
    params.push(normalizedAction);
    whereClauses.push(`action = $${params.length}`);
  }
  params.push(safeLimit);
  const limitParam = `$${params.length}`;
  params.push(safeOffset);
  const offsetParam = `$${params.length}`;

  const { rows } = await query(
    `SELECT id, offer_id, seller_user_id, action, source, created_at
       FROM offer_handled_queue_events
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}`,
    params
  );

  return {
    sellerUserId: sellerId,
    events: rows.map(mapHandledQueueEventRow),
    count: rows.length,
    limit: safeLimit,
    offset: safeOffset,
    filters: {
      offerId: requestedOfferId,
      action: normalizedAction,
    },
  };
}

export async function listOffers({ userId, role = "buyer", status, limit = 30, offset = 0 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const uid = parseUserId(userId);
  const normalizedRole = String(role || "buyer")
    .trim()
    .toLowerCase();
  const normalizedStatus = status != null ? String(status).trim().toLowerCase() : null;
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  if (!uid) return { error: "invalid_user", message: "Valid userId is required." };
  if (!(await userExists(uid))) return { error: "user_not_found", message: "User not found." };
  if (!["buyer", "seller"].includes(normalizedRole)) {
    return { error: "invalid_role", message: "role must be buyer or seller." };
  }
  if (normalizedStatus && normalizedStatus !== "all" && !OFFER_STATUSES.has(normalizedStatus)) {
    return {
      error: "invalid_offer_status",
      message: "status must be one of pending, accepted, declined, expired, or all.",
    };
  }

  await expirePendingOffers();

  const params = [uid];
  const whereClauses = [
    normalizedRole === "buyer" ? `o.buyer_user_id = $1` : `o.seller_user_id = $1`,
  ];
  if (normalizedStatus && normalizedStatus !== "all") {
    params.push(normalizedStatus);
    whereClauses.push(`o.status = $${params.length}`);
  }

  params.push(safeLimit);
  const limitParam = `$${params.length}`;
  params.push(safeOffset);
  const offsetParam = `$${params.length}`;

  const { rows } = await query(
    `SELECT
       o.*,
       ${OFFER_PRODUCT_SELECT},
       buyer.handle AS buyer_handle,
       buyer.shop_name AS buyer_shop_name,
       seller.handle AS seller_handle,
       seller.shop_name AS seller_shop_name
     FROM offers o
     LEFT JOIN products p ON p.id = o.product_id
     LEFT JOIN users buyer ON buyer.id = o.buyer_user_id
     LEFT JOIN users seller ON seller.id = o.seller_user_id
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY o.created_at DESC
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    params
  );

  return { offers: rows.map(mapOfferRow), count: rows.length, limit: safeLimit, offset: safeOffset };
}

export async function sendDirectMessage({ senderUserId, receiverUserId, content } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const senderId = parseUserId(senderUserId);
  const receiverId = parseUserId(receiverUserId);
  const body = String(content || "").trim();

  if (!senderId || !receiverId || !body) {
    return {
      error: "invalid_message_payload",
      message: "senderUserId, receiverUserId, and content are required.",
    };
  }
  if (!(await userExists(senderId))) {
    return { error: "sender_not_found", message: "Sender user not found." };
  }
  if (!(await userExists(receiverId))) {
    return { error: "receiver_not_found", message: "Receiver user not found." };
  }
  if (senderId === receiverId) {
    return { error: "invalid_message_payload", message: "Cannot send a message to yourself." };
  }
  if (body.length > 2000) {
    return { error: "message_too_long", message: "Message must be 2000 characters or less." };
  }
  if (hasForbiddenMessage(body)) {
    return {
      error: "message_blocked",
      message:
        "Message blocked: For your safety, sharing phone numbers or negotiating offline payments is strictly prohibited.",
    };
  }

  const { rows } = await query(
    `INSERT INTO messages (sender_user_id, receiver_user_id, content, is_flagged)
     VALUES ($1, $2, $3, FALSE)
     RETURNING id, sender_user_id, receiver_user_id, content, created_at`,
    [senderId, receiverId, body]
  );
  const row = rows[0];
  return {
    success: true,
    message: {
      id: Number(row.id),
      senderUserId: Number(row.sender_user_id),
      receiverUserId: Number(row.receiver_user_id),
      content: row.content,
      createdAt: row.created_at,
    },
  };
}

export async function getDirectThread({ userAId, userBId, limit = 50, offset = 0 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const a = parseUserId(userAId);
  const b = parseUserId(userBId);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  if (!a || !b) return { error: "invalid_thread_users", message: "userAId and userBId are required." };
  if (!(await userExists(a)) || !(await userExists(b))) {
    return { error: "user_not_found", message: "One or both users not found." };
  }

  const { rows } = await query(
    `SELECT id, sender_user_id, receiver_user_id, content, is_flagged, moderation_note, created_at
       FROM messages
      WHERE (sender_user_id = $1 AND receiver_user_id = $2)
         OR (sender_user_id = $2 AND receiver_user_id = $1)
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [a, b, safeLimit, safeOffset]
  );

  const messages = rows
    .map((row) => ({
      id: Number(row.id),
      senderUserId: Number(row.sender_user_id),
      receiverUserId: Number(row.receiver_user_id),
      content: row.content,
      isFlagged: Boolean(row.is_flagged),
      moderationNote: row.moderation_note || null,
      createdAt: row.created_at,
    }))
    .reverse();

  return { messages, count: messages.length, limit: safeLimit, offset: safeOffset };
}

function mapReviewRow(row) {
  return {
    id: Number(row.id),
    orderId: row.order_id != null ? Number(row.order_id) : null,
    orderTrackingCode: row.tracking_code || row.order_ref || null,
    orderRef: row.order_ref || row.tracking_code || null,
    sellerUserId: Number(row.seller_user_id),
    buyerUserId: Number(row.buyer_user_id),
    direction: row.direction === "seller_to_buyer" ? "seller_to_buyer" : "buyer_to_seller",
    rating: Number(row.rating),
    comment: row.comment || null,
    createdAt: row.created_at,
  };
}

function isDeliveredStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "delivered" || s === "completed";
}

export async function createOrderReview({
  orderId,
  buyerUserId,
  sellerUserId,
  rating,
  comment = "",
  buyerPhone = "",
  direction = "buyer_to_seller",
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const dir = direction === "seller_to_buyer" ? "seller_to_buyer" : "buyer_to_seller";
  const buyerId = parseUserId(buyerUserId);
  const sellerId = parseUserId(sellerUserId);
  const score = Number(rating);
  const text = String(comment || "").trim();
  const orderRefInput = String(orderId || "").trim();

  if (!orderRefInput || !buyerId || !sellerId || !Number.isFinite(score)) {
    return {
      error: "invalid_review_payload",
      message: "Order number (SK-xxxx), buyer, seller, and rating are required.",
    };
  }
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return { error: "invalid_rating", message: "Rating must be 1 to 5 stars." };
  }
  if (buyerId === sellerId) {
    return {
      error: "invalid_review_payload",
      message: dir === "seller_to_buyer" ? "You cannot rate yourself as a buyer." : "You cannot rate your own shop.",
    };
  }
  if (!(await userExists(buyerId))) {
    return { error: "buyer_not_found", message: "Buyer user not found." };
  }
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const order = await getOrderByReference(orderRefInput);
  if (!order) {
    return {
      error: "order_not_found",
      message: "Order not found. Use your Sokoni order number (e.g. SK-1042).",
    };
  }

  const status =
    order.source === "json"
      ? order.jsonOrder?.status || order.jsonOrder?.shipmentStatus || order.status
      : order.status;
  if (!isDeliveredStatus(status)) {
    return {
      error: "review_not_allowed",
      message:
        dir === "seller_to_buyer"
          ? "You can rate this buyer after the order is marked delivered."
          : "You can rate this shop after the order is marked delivered.",
    };
  }

  if (order.source === "json") {
    if (dir === "buyer_to_seller") {
      if (!jsonOrderBuyerMatches(order.jsonOrder, buyerId, buyerPhone || order.buyer_phone)) {
        return {
          error: "buyer_mismatch",
          message: "This order does not match your WhatsApp buyer account.",
        };
      }
    } else {
      const resolvedBuyer = await resolveBuyerUserIdForJsonOrder(order.jsonOrder);
      if (resolvedBuyer != null && resolvedBuyer !== buyerId) {
        return {
          error: "buyer_mismatch",
          message: "This order buyer does not match the buyer you are rating.",
        };
      }
      if (resolvedBuyer == null && !jsonOrderBuyerMatches(order.jsonOrder, buyerId, buyerPhone || order.buyer_phone)) {
        return {
          error: "buyer_mismatch",
          message: "Could not match this order to that buyer account.",
        };
      }
    }
  } else if (order.buyer_id != null && Number(order.buyer_id) !== buyerId) {
    return {
      error: "buyer_mismatch",
      message: "This order does not belong to the buyer provided.",
    };
  }

  const orderSellerUserId =
    order.seller_user_id != null ? Number(order.seller_user_id) : null;
  if (orderSellerUserId != null && orderSellerUserId !== sellerId) {
    return {
      error: "seller_mismatch",
      message: "This order is for a different shop.",
    };
  }
  if (orderSellerUserId == null && order.source === "json") {
    return {
      error: "seller_mismatch",
      message: "Could not match this order to the shop. Message Sokoni support with your SK number.",
    };
  }

  const orderRef = String(order.tracking_code || orderRefInput).toUpperCase();
  const pgOrderId = order.source === "postgres" ? Number(order.id) : null;

  if (await reviewAlreadyExists({ orderId: pgOrderId, orderRef, direction: dir })) {
    return {
      error: "review_exists",
      message:
        dir === "seller_to_buyer"
          ? "You already rated this buyer for this order."
          : "You already left a review for this order.",
    };
  }

  const inserted = await query(
    `INSERT INTO order_reviews (order_id, order_ref, seller_user_id, buyer_user_id, rating, comment, direction)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, order_id, order_ref, seller_user_id, buyer_user_id, rating, comment, direction, created_at`,
    [pgOrderId, orderRef, sellerId, buyerId, score, text || null, dir]
  );

  const review = {
    ...mapReviewRow(inserted.rows[0]),
    orderTrackingCode: orderRef,
  };
  return { success: true, review };
}

/**
 * Delivered orders for this buyer+seller that still need a rating.
 */
export async function listReviewableOrdersForSeller({
  buyerUserId,
  sellerUserId,
  buyerPhone = "",
  limit = 20,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const buyerId = parseUserId(buyerUserId);
  const sellerId = parseUserId(sellerUserId);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  if (!buyerId || !sellerId) {
    return {
      error: "invalid_review_payload",
      message: "buyerUserId and sellerUserId are required.",
    };
  }

  const out = [];

  // JSON prepaid orders (SK-*)
  const customerKey = `web:buyer:${buyerId}`;
  const jsonOrders = getOrdersForCustomer(customerKey, buyerPhone);
  for (const order of jsonOrders) {
    if (out.length >= safeLimit) break;
    if (!isDeliveredStatus(order.status) && !isDeliveredStatus(order.shipmentStatus)) continue;
    const orderSeller = await resolveSellerUserIdForJsonOrder(order);
    if (orderSeller !== sellerId) continue;
    if (await reviewAlreadyExists({ orderRef: order.id, direction: "buyer_to_seller" })) continue;
    out.push({
      orderId: order.id,
      orderRef: order.id,
      productName: order.productName || order.productId || "Order",
      status: order.status,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
      source: "json",
    });
  }

  // Postgres orders linked via order_items → products.seller_user_id
  try {
    const { rows } = await query(
      `SELECT
         o.id,
         o.tracking_code,
         o.status,
         o.created_at,
         (
           SELECT oi.title FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id ASC LIMIT 1
         ) AS product_title
       FROM orders o
       WHERE o.buyer_id = $1
         AND o.status::text IN ('delivered', 'completed')
         AND EXISTS (
           SELECT 1
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
           LEFT JOIN sellers s ON s.id = oi.seller_id
           WHERE oi.order_id = o.id
             AND COALESCE(p.seller_user_id, s.user_id) = $2
         )
         AND NOT EXISTS (
           SELECT 1 FROM order_reviews r
           WHERE r.direction = 'buyer_to_seller'
             AND (
               r.order_id = o.id
               OR (r.order_ref IS NOT NULL AND UPPER(r.order_ref) = UPPER(o.tracking_code))
             )
         )
       ORDER BY o.created_at DESC
       LIMIT $3`,
      [buyerId, sellerId, safeLimit]
    );
    for (const row of rows) {
      if (out.length >= safeLimit) break;
      const ref = row.tracking_code || String(row.id);
      if (out.some((o) => String(o.orderRef).toUpperCase() === String(ref).toUpperCase())) continue;
      out.push({
        orderId: row.tracking_code || String(row.id),
        orderRef: ref,
        productName: row.product_title || "Order",
        status: row.status,
        createdAt: row.created_at,
        source: "postgres",
      });
    }
  } catch (err) {
    console.warn("[social] listReviewableOrdersForSeller pg:", err.message);
  }

  return {
    buyerUserId: buyerId,
    sellerUserId: sellerId,
    orders: out.slice(0, safeLimit),
    count: Math.min(out.length, safeLimit),
  };
}

export async function listSellerReviews({ sellerUserId, limit = 20, offset = 0 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const sellerId = parseUserId(sellerUserId);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  if (!sellerId) return { error: "invalid_user", message: "Valid sellerUserId is required." };
  if (!(await userExists(sellerId))) {
    return { error: "seller_not_found", message: "Seller user not found." };
  }

  const { rows } = await query(
    `SELECT
       r.id,
       r.order_id,
       r.order_ref,
       r.seller_user_id,
       r.buyer_user_id,
       r.rating,
       r.comment,
       r.direction,
       r.created_at,
       COALESCE(o.tracking_code, r.order_ref) AS tracking_code
     FROM order_reviews r
     LEFT JOIN orders o ON o.id = r.order_id
     WHERE r.seller_user_id = $1
       AND r.direction = 'buyer_to_seller'
     ORDER BY r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [sellerId, safeLimit, safeOffset]
  );

  return {
    reviews: rows.map(mapReviewRow),
    count: rows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * Delivered orders for this seller that still need a buyer rating.
 */
export async function listReviewableBuyersForSeller({
  sellerUserId,
  supplierId = null,
  limit = 20,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const sellerId = parseUserId(sellerUserId);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  if (!sellerId) {
    return { error: "invalid_user", message: "Valid sellerUserId is required." };
  }

  const out = [];

  // JSON prepaid orders owned by this seller
  try {
    const { listAllOrders } = await import("../../services/orders.js");
    const orders = listAllOrders();
    for (const order of orders) {
      if (out.length >= safeLimit) break;
      if (order.status === "cancelled") continue;
      if (!isDeliveredStatus(order.status) && !isDeliveredStatus(order.shipmentStatus)) continue;
      const orderSeller = await resolveSellerUserIdForJsonOrder(order);
      const ownsOrder =
        orderSeller === sellerId || (supplierId && order.supplierId === supplierId);
      if (!ownsOrder) continue;
      const buyerId = await resolveBuyerUserIdForJsonOrder(order);
      if (!buyerId) continue;
      if (await reviewAlreadyExists({ orderRef: order.id, direction: "seller_to_buyer" })) continue;
      out.push({
        orderId: order.id,
        orderRef: order.id,
        buyerUserId: buyerId,
        productName: order.productName || order.productId || "Order",
        status: order.status,
        createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
        source: "json",
      });
    }
  } catch (err) {
    console.warn("[social] listReviewableBuyersForSeller json:", err.message);
  }

  try {
    const { rows } = await query(
      `SELECT
         o.id,
         o.tracking_code,
         o.status,
         o.created_at,
         o.buyer_id,
         (
           SELECT oi.title FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id ASC LIMIT 1
         ) AS product_title
       FROM orders o
       WHERE o.status::text IN ('delivered', 'completed')
         AND o.buyer_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
           LEFT JOIN sellers s ON s.id = oi.seller_id
           WHERE oi.order_id = o.id
             AND COALESCE(p.seller_user_id, s.user_id) = $1
         )
         AND NOT EXISTS (
           SELECT 1 FROM order_reviews r
           WHERE r.direction = 'seller_to_buyer'
             AND (
               r.order_id = o.id
               OR (r.order_ref IS NOT NULL AND UPPER(r.order_ref) = UPPER(o.tracking_code))
             )
         )
       ORDER BY o.created_at DESC
       LIMIT $2`,
      [sellerId, safeLimit]
    );
    for (const row of rows) {
      if (out.length >= safeLimit) break;
      const ref = row.tracking_code || String(row.id);
      if (out.some((o) => String(o.orderRef).toUpperCase() === String(ref).toUpperCase())) continue;
      out.push({
        orderId: row.tracking_code || String(row.id),
        orderRef: ref,
        buyerUserId: Number(row.buyer_id),
        productName: row.product_title || "Order",
        status: row.status,
        createdAt: row.created_at,
        source: "postgres",
      });
    }
  } catch (err) {
    console.warn("[social] listReviewableBuyersForSeller pg:", err.message);
  }

  return {
    sellerUserId: sellerId,
    orders: out.slice(0, safeLimit),
    count: Math.min(out.length, safeLimit),
  };
}

export async function listBuyerReviews({ buyerUserId, limit = 20, offset = 0 } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const buyerId = parseUserId(buyerUserId);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  if (!buyerId) return { error: "invalid_user", message: "Valid buyerUserId is required." };
  if (!(await userExists(buyerId))) {
    return { error: "buyer_not_found", message: "Buyer user not found." };
  }

  const { rows } = await query(
    `SELECT
       r.id,
       r.order_id,
       r.order_ref,
       r.seller_user_id,
       r.buyer_user_id,
       r.rating,
       r.comment,
       r.direction,
       r.created_at,
       COALESCE(o.tracking_code, r.order_ref) AS tracking_code
     FROM order_reviews r
     LEFT JOIN orders o ON o.id = r.order_id
     WHERE r.buyer_user_id = $1
       AND r.direction = 'seller_to_buyer'
     ORDER BY r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [buyerId, safeLimit, safeOffset]
  );

  const summary = await getBuyerReviewSummary(buyerId);

  return {
    reviews: rows.map(mapReviewRow),
    count: rows.length,
    limit: safeLimit,
    offset: safeOffset,
    avgRating: summary.avgRating,
    totalReviews: summary.totalReviews,
  };
}
