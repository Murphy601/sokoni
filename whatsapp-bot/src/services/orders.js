import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

/**
 * Lightweight file-backed order + contact store. Good enough for a single
 * WAHA instance. Swap for a real DB when you scale to multiple stores/staff.
 */
export const ORDER_STATUSES = ["received", "confirmed", "packed", "out_for_delivery", "delivered", "cancelled"];

const STATUS_ALIASES = {
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
  const order = {
    id,
    customerKey,
    chatId: chatId || customerKey,
    productId: product.productId || product.id,
    productName: product.name,
    priceKes: product.priceKes,
    customerName: details.name,
    location: details.location,
    phone: details.phone,
    status: "received",
    history: [{ status: "received", at: now }],
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

export function getOrdersForCustomer(customerKey) {
  load();
  return Object.values(store.orders)
    .filter((o) => o.customerKey === customerKey)
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
  order.status = status;
  order.history.push({ status, at: Date.now() });
  order.updatedAt = Date.now();
  persist();
  return { order, status };
}
