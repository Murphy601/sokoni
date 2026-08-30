import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isPrepaidOnly } from "./prepaid-checkout.js";
import { computeProductTotals, orderBuyerTotal, resolveSellerPayoutKes } from "./shipping-tiers.js";
import { assertPurchaseQty, findVariant } from "./product-availability.js";
import { assertOrderTransition, canCancelOrder } from "../lib/status-transitions.js";
import { assertSupplierCanSell } from "./enforce-account.js";
export {
  normalizeOrderId,
  extractOrderIdFromText,
  ORDER_ID_RE,
  ORDER_ID_CAPTURE,
  isSokoniOrderId,
} from "../lib/order-id.js";
import { normalizeOrderId } from "../lib/order-id.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

/**
 * Lightweight file-backed order + contact store. Good enough for a single
 * WAHA instance. Swap for a real DB when you scale to multiple stores/staff.
 */
export const ORDER_STATUSES = [
  "awaiting_payment",
  "payment_expired",
  "received",
  "confirmed",
  "packed",
  "out_for_delivery",
  "delivered",
  "cancelled",
];

const STATUS_ALIASES = {
  awaiting_payment: "awaiting_payment",
  awaiting: "awaiting_payment",
  unpaid: "awaiting_payment",
  payment: "awaiting_payment",
  payment_expired: "payment_expired",
  expired: "payment_expired",
  stk_expired: "payment_expired",
  received: "received",
  new: "received",
  confirm: "confirmed",
  confirmed: "confirmed",
  pack: "packed",
  packed: "packed",
  packing: "packed",
  out: "out_for_delivery",
  dispatch: "out_for_delivery",
  dispatched: "out_for_delivery",
  delivery: "out_for_delivery",
  out_for_delivery: "out_for_delivery",
  deliver: "delivered",
  delivered: "delivered",
  done: "delivered",
  complete: "delivered",
  cancel: "cancelled",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const STATUS_LABELS = {
  awaiting_payment: "💳 Awaiting payment",
  payment_expired: "⌛ Payment expired",
  received: "🆕 Received",
  confirmed: "✅ Confirmed",
  packed: "📦 Packed",
  out_for_delivery: "🛵 Out for delivery",
  delivered: "🎉 Delivered",
  cancelled: "❌ Cancelled",
};

let store = { seq: 1000, sknSeq: 1000, orders: {}, cartOrders: {}, contacts: {} };
let loaded = false;
let loadedMtimeMs = 0;

function fileMtimeMs(file) {
  try {
    return existsSync(file) ? statSync(file).mtimeMs : 0;
  } catch {
    return 0;
  }
}

function load() {
  const mtime = fileMtimeMs(ORDERS_FILE);
  // Re-read when ops scripts rewrite orders.json on disk.
  if (loaded && mtime === loadedMtimeMs) return;
  loaded = true;
  loadedMtimeMs = mtime;
  try {
    if (existsSync(ORDERS_FILE)) {
      store = {
        seq: 1000,
        sknSeq: 1000,
        orders: {},
        cartOrders: {},
        contacts: {},
        ...JSON.parse(readFileSync(ORDERS_FILE, "utf-8")),
      };
      if (!store.cartOrders) store.cartOrders = {};
      if (!store.sknSeq) store.sknSeq = 1000;
    }
  } catch (err) {
    console.error("[orders] failed to load store:", err.message);
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(ORDERS_FILE, JSON.stringify(store, null, 2));
    loadedMtimeMs = fileMtimeMs(ORDERS_FILE);
  } catch (err) {
    console.error("[orders] failed to persist store:", err.message);
  }
}

/** Shared with cart-orders.js — keep single file-backed store. */
export function loadOrderStore() {
  load();
}

export function persistOrderStore() {
  persist();
}

export function getOrderStore() {
  load();
  return store;
}

export function normalizeStatus(input) {
  if (!input) return null;
  const key = String(input).toLowerCase().replace(/\s+/g, "_").replace(/[^\w]/g, "");
  return STATUS_ALIASES[key] || (ORDER_STATUSES.includes(key) ? key : null);
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

/** Record/refresh a contact so we can broadcast to them later. */
export function registerContact(customerKey, meta = {}) {
  if (!customerKey) return;
  load();
  const existing = store.contacts[customerKey] || {};
  store.contacts[customerKey] = {
    ...existing,
    chatId: meta.chatId || existing.chatId || customerKey,
    displayName: meta.displayName || existing.displayName || "",
    phone: meta.phone || existing.phone || null,
    lastSeen: Date.now(),
  };
  persist();
}

export function getAllContacts() {
  load();
  return Object.entries(store.contacts).map(([key, c]) => ({ customerKey: key, ...c }));
}

/** Phone digits previously seen for this WhatsApp chat (may be empty for @lid). */
export function getContactPhone(customerKey) {
  if (!customerKey) return null;
  load();
  const phone = store.contacts[customerKey]?.phone;
  return phone ? String(phone).replace(/\D/g, "") || null : null;
}


/** Next SKN parent id — shared by single-item checkout and multi-seller cart. */
export function allocateSknParentId(orderStore = store) {
  orderStore.sknSeq = Math.max(1000, Number(orderStore.sknSeq) || 1000) + 1;
  return `SKN-${orderStore.sknSeq}`;
}

export function createOrder({ customerKey, chatId, product, details, offerId = null, totalsOverride = null }) {
  load();
  const qty = Math.max(1, Math.round(Number(details?.quantity || details?.qty || 1) || 1));
  const variantId = details?.variantId || product?.selectedVariantId || null;
  const stockGate = assertPurchaseQty(product, qty, { variantId });
  if (!stockGate.ok) {
    const err = new Error(stockGate.message || "Out of stock");
    err.code = stockGate.error || "insufficient_stock";
    err.onHand = stockGate.onHand;
    throw err;
  }
  const sellGate = assertSupplierCanSell(product?.supplierId);
  if (!sellGate.ok) {
    const err = new Error(sellGate.message || "This store is currently unavailable.");
    err.code = sellGate.error || "shop_unavailable";
    err.shopStatus = sellGate.shopStatus;
    throw err;
  }
  // Keep store.seq advancing for other ID families (DR-/WD-); order ids are SKN-.
  store.seq += 1;
  const id = allocateSknParentId(store);
  const now = Date.now();
  const sourcePriceKes = product.sourcePriceKes != null ? Number(product.sourcePriceKes) : null;
  const totals = totalsOverride || computeProductTotals(product);
  const priceKes = totals.itemKes;
  const shippingKes = totals.shippingKes;
  const totalKes = totals.totalKes;
  const platformFeeKes = totals.platformFeeKes;
  const transactionFeeKes = totals.transactionFeeKes ?? 0;
  const shippingCommissionKes = totals.shippingCommissionKes ?? 0;
  const sellerNetKes = totals.sellerNetKes;
  const sellerPayoutKes = totals.sellerPayoutKes ?? resolveSellerPayoutKes({ ...totals, ...product });
  const deliveryMethod = totals.deliveryMethod || product.deliveryMethod || "hub";
  const shippingRecipient =
    totals.shippingRecipient || product.shippingRecipient || (deliveryMethod === "hub" ? "platform" : "seller");
  const marginKes =
    sourcePriceKes != null && priceKes != null ? Math.max(0, priceKes - sourcePriceKes) : null;

  const prepaid = isPrepaidOnly();
  const offerKey = offerId != null && String(offerId).trim() !== "" ? String(offerId).trim() : null;

  const order = {
    id,
    customerKey,
    chatId: chatId || customerKey,
    productId: product.productId || product.id,
    productName: product.name,
    quantity: qty,
    variantId: variantId || null,
    variantLabel: (() => {
      if (!variantId) return null;
      const v = findVariant(product, variantId);
      if (!v) return null;
      return [v.size, v.color].filter(Boolean).join(" / ") || v.id;
    })(),
    priceKes,
    shippingKes,
    totalKes,
    platformFeeKes,
    shippingCommissionKes,
    transactionFeeKes,
    sellerNetKes,
    sellerPayoutKes,
    deliveryMethod,
    shippingRecipient,
    sourcePriceKes,
    marginKes,
    offerId: offerKey,
    offerAmountKes: offerKey ? totalKes : null,
    /** Item promo snapshot — only when seller set an active promo on this product. */
    promoApplied:
      product.promo?.active === true
        ? {
            type: product.promo.type || null,
            value: product.promo.value != null ? Number(product.promo.value) : null,
            listPriceKes:
              product.promo.listPriceKes != null
                ? Number(product.promo.listPriceKes)
                : product.originalPriceKes != null
                  ? Number(product.originalPriceKes)
                  : null,
            chargedKes: totalKes,
          }
        : null,
    supplierId: product.supplierId || null,
    supplierSku: product.supplierSku || null,
    /** Social shop user id — sticky for reviews / sale ratings. */
    sellerUserId: (() => {
      const n = Number(product.sellerUserId ?? product.seller?.id);
      return Number.isInteger(n) && n > 0 ? n : null;
    })(),
    shopHandle: product.shopHandle || product.sellerHandle || null,
    customerName: details.name,
    location: details.location,
    phone: details.phone,
    /** Feature 2 — structured landmark / hub (optional; location remains the display string). */
    deliveryType: details.deliveryType || null,
    deliveryCounty: details.deliveryCounty || details.buyerCounty || null,
    deliveryTown: details.deliveryTown || details.landmarkTown || null,
    landmarkTown: details.landmarkTown || details.deliveryTown || null,
    landmarkSpot: details.landmarkSpot || null,
    landmarkInstructions: details.landmarkInstructions || details.landmarkNote || null,
    landmarkId: details.landmarkId || null,
    status: prepaid ? "awaiting_payment" : "received",
    paymentModel: prepaid ? "prepaid" : "cod",
    escrowStatus: prepaid ? "pending" : null,
    deliveryMode: "pending",
    shareCustomerContact: false,
    supplierNotified: false,
    payoutStatus: sourcePriceKes != null ? "pending" : "n/a",
    customerPaymentStatus: "unpaid",
    paymentStatus: "pending",
    checkoutRequestId: null,
    merchantRequestId: null,
    mpesaReceipt: null,
    mpesaPhone: null,
    paidAt: null,
    dropOffCode: null,
    labelUrl: null,
    qrPayload: null,
    shipmentStatus: "pending",
    shipmentHistory: [],
    payoutEligibleAt: null,
    autoPayment: false,
    customerPaidClaimedAt: null,
    customerPaidConfirmedAt: null,
    pickupPointId: null,
    pickupPointName: null,
    pickupPointPhone: null,
    fulfillmentStoreId: null,
    fulfillmentStoreName: null,
    fulfillmentStorePhone: null,
    fulfillmentStoreCity: null,
    storeNotifiedPaymentAt: null,
    history: [{ status: prepaid ? "awaiting_payment" : "received", at: now }],
    reviewPromptSent: false,
    createdAt: now,
    updatedAt: now,
  };
  store.orders[id] = order;
  persist();
  return order;
}

export function markReviewPromptSent(id) {
  load();
  const order = getOrder(id);
  if (!order || order.reviewPromptSent) return order;
  order.reviewPromptSent = true;
  order.updatedAt = Date.now();
  persist();
  return order;
}

export function getOrder(id) {
  load();
  const key = normalizeOrderId(id);
  if (!key) return null;
  if (store.orders[key]) return store.orders[key];
  if (store.cartOrders?.[key]) return store.cartOrders[key];
  // Legacy SK-#### ↔ SKN-#### same digits (single-item prefix migration).
  const skMatch = key.match(/^SK-(\d+)$/);
  const sknMatch = key.match(/^SKN-(\d+)$/);
  if (skMatch) {
    const alt = `SKN-${skMatch[1]}`;
    if (store.orders[alt]) return store.orders[alt];
    if (store.cartOrders?.[alt]) return store.cartOrders[alt];
  } else if (sknMatch) {
    const alt = `SK-${sknMatch[1]}`;
    if (store.orders[alt]) return store.orders[alt];
  }
  return null;
}

export function listAllOrders() {
  load();
  return Object.values(store.orders || {});
}

export function findOrderByCheckoutRequestId(checkoutRequestId) {
  if (!checkoutRequestId) return null;
  load();
  const ref = String(checkoutRequestId);
  const match = (o) =>
    o.checkoutRequestId === ref ||
    o.paystackReference === ref ||
    o.merchantRequestId === ref;
  const fromOrders = Object.values(store.orders).find(match) || null;
  if (fromOrders) return fromOrders;
  return Object.values(store.cartOrders || {}).find(match) || null;
}

export function findAwaitingPaymentOrderForCustomer(customerKey, phone = "") {
  const orders = getOrdersForCustomer(customerKey, phone);
  return (
    orders.find(
      (o) =>
        o.status === "awaiting_payment" &&
        o.customerPaymentStatus !== "confirmed" &&
        o.status !== "cancelled"
    ) || null
  );
}

/** Fallback match when Daraja callback omits CheckoutRequestID linkage. */
export function findProcessingOrderByPhoneAmount(phone, amountKes) {
  load();
  const wantPhone = normalizePhoneDigits(phone);
  const wantAmt = Math.round(Number(amountKes));
  if (!wantPhone || !Number.isFinite(wantAmt)) return null;

  const candidates = Object.values(store.orders).filter((o) => {
    // Cart children are paid via parent STK — never match STK amount to a child line.
    if (o.kind === "cart_child") return false;
    if (o.customerPaymentStatus === "confirmed") return false;
    if (o.paymentStatus !== "processing" && o.status !== "awaiting_payment") return false;
    const orderPhone = normalizePhoneDigits(o.phone || o.mpesaPhone);
    if (orderPhone !== wantPhone) return false;
    return Math.round(Number(orderBuyerTotal(o))) === wantAmt;
  });
  candidates.sort((a, b) => (b.stkSentAt || b.createdAt || 0) - (a.stkSentAt || a.createdAt || 0));
  return candidates[0] || null;
}

function normalizePhoneDigits(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  if (!d.startsWith("254") && d.length >= 9) d = `254${d}`;
  return d;
}

function normalizeOrderPhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("254")) return d;
  if (d.startsWith("0") && d.length >= 10) return `254${d.slice(1)}`;
  if (d.length === 9) return `254${d}`;
  return d;
}

export function getOrdersForCustomer(customerKey, phone = "") {
  load();
  const want = normalizeOrderPhone(phone);

  return Object.values(store.orders)
    .filter((o) => {
      // Hide cart children in list views — parent SKN summarizes them.
      if (o.kind === "cart_child") return false;
      if (o.customerKey === customerKey) return true;
      if (!want) return false;
      const orderPhone = normalizeOrderPhone(o.phone);
      const orderKeyPhone = normalizeOrderPhone(String(o.customerKey || "").replace(/\D/g, ""));
      return orderPhone === want || orderKeyPhone === want;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Safe buyer-facing purchase row (no seller cost fields). */
export function toBuyerPurchaseSummary(order) {
  if (!order) return null;
  return {
    id: order.id,
    productName: order.productName || null,
    productId: order.productId || null,
    totalKes: order.totalKes ?? order.priceKes ?? null,
    status: order.status || null,
    paymentStatus: order.customerPaymentStatus || order.paymentStatus || null,
    escrowStatus: order.escrowStatus || null,
    shipmentStatus: order.shipmentStatus || null,
    createdAt: order.createdAt || null,
    paidAt: order.paidAt || null,
    trackUrl: `/track.html?order=${encodeURIComponent(order.id)}`,
    checkoutUrl: `/checkout.html?order=${encodeURIComponent(order.id)}`,
  };
}

/**
 * Purchases for a site account: linked by accountUserId, or matching phone.
 */
export function getPurchasesForAccount({ userId, phone } = {}) {
  load();
  const uid = Number(userId);
  const want = normalizeOrderPhone(phone);
  return Object.values(store.orders)
    .filter((o) => {
      if (uid && Number(o.accountUserId) === uid) return true;
      if (!want) return false;
      const orderPhone = normalizeOrderPhone(o.phone);
      const orderKeyPhone = normalizeOrderPhone(String(o.customerKey || "").replace(/\D/g, ""));
      return orderPhone === want || orderKeyPhone === want;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toBuyerPurchaseSummary);
}

/**
 * Attach order to an account when phone matches (or already linked).
 */
export function claimOrderForAccount(orderId, { userId, phone, email } = {}) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found", message: "Order not found." };
  const uid = Number(userId);
  if (!uid) return { error: "invalid_user", message: "Sign in required." };

  if (Number(order.accountUserId) === uid) {
    return { ok: true, order: toBuyerPurchaseSummary(order), alreadyLinked: true };
  }
  if (order.accountUserId && Number(order.accountUserId) !== uid) {
    return { error: "already_claimed", message: "This order is linked to another account." };
  }

  const want = normalizeOrderPhone(phone);
  const orderPhone = normalizeOrderPhone(order.phone);
  const orderKeyPhone = normalizeOrderPhone(String(order.customerKey || "").replace(/\D/g, ""));
  if (!want || (orderPhone !== want && orderKeyPhone !== want)) {
    return {
      error: "phone_mismatch",
      message: "Add the WhatsApp number used on this order to your account, then try again.",
    };
  }

  updateOrderMeta(order.id, {
    accountUserId: uid,
    accountEmail: email || order.accountEmail || null,
  });
  return { ok: true, order: toBuyerPurchaseSummary(getOrder(order.id)) };
}

export function listRecentOrders(limit = 10) {
  load();
  return Object.values(store.orders)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function updateOrderStatus(id, statusInput, opts = {}) {
  const { force = false, actorPhone = null, source = "orders.updateOrderStatus" } = opts;
  const order = getOrder(id);
  if (!order) return null;
  const status = normalizeStatus(statusInput);
  if (!status) return { error: "invalid_status", order };
  if (order.status === status) return { order, status, unchanged: true };

  const gate = assertOrderTransition(order.status, status, { force });
  if (!gate.ok) {
    return { error: gate.error, message: gate.message, order, from: gate.from, to: gate.to };
  }
  if (status === "cancelled" && !force) {
    const cancelGate = canCancelOrder({
      orderStatus: order.status,
      dispatchStatus: order.bodaStatus,
      custodyStatus: order.bodaCustody,
      force,
    });
    if (!cancelGate.ok) {
      return { error: cancelGate.error, message: cancelGate.message, order };
    }
  }

  const fromStatus = order.status;
  order.status = status;
  order.history.push({ status, at: Date.now() });
  order.updatedAt = Date.now();
  persist();

  // Seller-initiated cancel only (explicit flag — not buyer/dispute refunds)
  if (status === "cancelled" && fromStatus !== "cancelled" && opts.sellerCancel) {
    import("./rating-engine.js")
      .then(async ({ penalizeSellerCancel }) => {
        const { ensureOrderSellerUserId } = await import("../db/repositories/social.js");
        const sellerUserId = await ensureOrderSellerUserId(order);
        if (sellerUserId) {
          await penalizeSellerCancel(sellerUserId, String(order.id).toUpperCase());
        }
      })
      .catch((err) => console.warn("[orders] seller cancel rating skipped:", err?.message || err));
  }

  import("./audit-log.js")
    .then(({ writeAuditLog }) =>
      writeAuditLog({
        orderRef: order.id,
        actorPhone,
        action: `ORDER_STATUS_${String(status).toUpperCase()}`,
        fromStatus,
        toStatus: status,
        source,
        metadata: { force: Boolean(force), sellerCancel: Boolean(opts.sellerCancel) },
      })
    )
    .catch(() => {});

  return { order, status };
}

export function updateOrderMeta(id, patch) {
  const order = getOrder(id);
  if (!order) return null;
  Object.assign(order, patch, { updatedAt: Date.now() });
  persist();
  return order;
}
