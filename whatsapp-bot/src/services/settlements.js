import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getSupplier } from "./suppliers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const SETTLEMENTS_FILE = path.join(DATA_DIR, "settlements.json");

let store = { entries: [] };
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(SETTLEMENTS_FILE)) {
      store = { entries: [], ...JSON.parse(readFileSync(SETTLEMENTS_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[settlements] failed to load:", err.message);
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SETTLEMENTS_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error("[settlements] failed to persist:", err.message);
  }
}

/** Record supplier payout owed when order is delivered (COD collected). */
export function recordDeliveryPayout(order) {
  if (!order?.supplierId || !order.sourcePriceKes) return null;
  load();

  const existing = store.entries.find((e) => e.orderId === order.id && e.status !== "cancelled");
  if (existing) return existing;

  const supplier = getSupplier(order.supplierId);
  const entry = {
    id: `PAY-${order.id}`,
    orderId: order.id,
    supplierId: order.supplierId,
    supplierName: supplier?.businessName || order.supplierId,
    supplierPhone: supplier?.phone || "",
    productName: order.productName,
    payoutAmountKes: order.sourcePriceKes,
    marginKes: order.marginKes || Math.max(0, (order.priceKes || 0) - (order.sourcePriceKes || 0)),
    retailKes: order.priceKes,
    status: "owed",
    createdAt: Date.now(),
    deliveredAt: Date.now(),
    paidAt: null,
  };

  store.entries.unshift(entry);
  if (store.entries.length > 500) store.entries.length = 500;
  persist();
  return entry;
}

export function listOwedPayouts(limit = 20) {
  load();
  return store.entries.filter((e) => e.status === "owed").slice(0, limit);
}

export function markPayoutPaid(orderId) {
  load();
  const entry = store.entries.find((e) => e.orderId === orderId && e.status === "owed");
  if (!entry) return null;
  entry.status = "paid";
  entry.paidAt = Date.now();
  persist();
  return entry;
}

export function getSettlementSummary() {
  load();
  const owed = store.entries.filter((e) => e.status === "owed");
  const totalOwed = owed.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  return { count: owed.length, totalOwedKes: totalOwed, entries: owed };
}
