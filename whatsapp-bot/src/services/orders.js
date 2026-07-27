import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isPrepaidOnly } from "./prepaid-checkout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

/**
 * Lightweight file-backed order + contact store. Good enough for a single
 * WAHA instance. Swap for a real DB when you scale to multiple stores/staff.
 */
export const ORDER_STATUSES = [
  "awaiting_payment",
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
  received: "🆕 Received",
  confirmed: "✅ Confirmed",
  packed: "📦 Packed",
  out_for_delivery: "🛵 Out for delivery",
  delivered: "🎉 Delivered",
  cancelled: "❌ Cancelled",
};

let store = { seq: 1000, orders: {}, contacts: {} };
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(ORDERS_FILE)) {
      store = { seq: 1000, orders: {}, contacts: {}, ...JSON.parse(readFileSync(ORDERS_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[orders] failed to load store:", err.message);
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(ORDERS_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error("[orders] failed to persist store:", err.message);
  }
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


export function createOrder({ customerKey, chatId, product, details }) {
  load();
  store.seq += 1;
  const id = `SK-${store.seq}`;
  const now = Date.now();
  const sourcePriceKes = product.sourcePriceKes != null ? Number(product.sourcePriceKes) : null;
  const priceKes = product.priceKes != null ? Number(product.priceKes) : null;
  const marginKes =
    sourcePriceKes != null && priceKes != null ? Math.max(0, priceKes - sourcePriceKes) : null;

  const prepaid = isPrepaidOnly();

  const order = {
    id,
    customerKey,
    chatId: chatId || customerKey,
    productId: product.productId || product.id,
    productName: product.name,
    priceKes,
    sourcePriceKes,
    marginKes,
    supplierId: product.supplierId || null,
    supplierSku: product.supplierSku || null,
    customerName: details.name,
    location: details.location,
    phone: details.phone,
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
  if (!id) return null;
  const key = String(id).toUpperCase().startsWith("SK-") ? String(id).toUpperCase() : `SK-${String(id).replace(/\D/g, "")}`;
  return store.orders[key] || null;
}

export function findOrderByCheckoutRequestId(checkoutRequestId) {
  if (!checkoutRequestId) return null;
  load();
  return (
    Object.values(store.orders).find((o) => o.checkoutRequestId === checkoutRequestId) || null
  );
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
    if (o.customerPaymentStatus === "confirmed") return false;
    if (o.paymentStatus !== "processing" && o.status !== "awaiting_payment") return false;
    const orderPhone = normalizePhoneDigits(o.phone || o.mpesaPhone);
    if (orderPhone !== wantPhone) return false;
    return Math.round(Number(o.priceKes)) === wantAmt;
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

export function getOrdersForCustomer(customerKey, phone = "") {
  load();
  const digits = String(phone || "").replace(/\D/g, "");
  const norm = (d) => {
    if (!d) return "";
    if (d.startsWith("254")) return d;
    if (d.startsWith("0") && d.length >= 10) return `254${d.slice(1)}`;
    if (d.length === 9) return `254${d}`;
    return d;
  };
  const want = norm(digits);

  return Object.values(store.orders)
    .filter((o) => {
      if (o.customerKey === customerKey) return true;
      if (!want) return false;
      const orderPhone = norm(String(o.phone || "").replace(/\D/g, ""));
      const orderKeyPhone = norm(String(o.customerKey || "").replace(/\D/g, ""));
      return orderPhone === want || orderKeyPhone === want;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function listRecentOrders(limit = 10) {
  load();
  return Object.values(store.orders)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function updateOrderStatus(id, statusInput) {
  const order = getOrder(id);
  if (!order) return null;
  const status = normalizeStatus(statusInput);
  if (!status) return { error: "invalid_status", order };
  if (order.status === status) return { order, status, unchanged: true };
  order.status = status;
  order.history.push({ status, at: Date.now() });
  order.updatedAt = Date.now();
  persist();
  return { order, status };
}

export function updateOrderMeta(id, patch) {
  const order = getOrder(id);
  if (!order) return null;
  Object.assign(order, patch, { updatedAt: Date.now() });
  persist();
  return order;
}
