import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getSupplier } from "./suppliers.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import { getOrder } from "./orders.js";

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

/** Add N business days (Mon–Fri) in Africa/Nairobi calendar. */
export function addBusinessDays(fromMs, days) {
  let d = new Date(fromMs);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d.getTime();
}

function buildPayoutEntry(order, { status, payoutEligibleAt = null } = {}) {
  const supplier = getSupplier(order.supplierId);
  const buyerTotal = orderBuyerTotal(order);
  const payoutAmountKes =
    order.sellerNetKes != null
      ? order.sellerNetKes
      : order.sourcePriceKes || Math.round(buyerTotal * 0.9);
  return {
    id: `PAY-${order.id}`,
    orderId: order.id,
    supplierId: order.supplierId,
    supplierName: supplier?.businessName || order.supplierId,
    supplierPhone: supplier?.phone || "",
    productName: order.productName,
    payoutAmountKes,
    marginKes: order.platformFeeKes ?? Math.max(0, buyerTotal - payoutAmountKes),
    retailKes: buyerTotal,
    itemKes: order.priceKes,
    shippingKes: order.shippingKes ?? 0,
    status,
    createdAt: Date.now(),
    deliveredAt: Date.now(),
    payoutEligibleAt,
    paidAt: null,
  };
}

/**
 * Schedule seller payout 3 business days after delivery (Depop-style escrow release).
 */
export function scheduleSellerPayoutAfterDelivery(order) {
  if (!order?.supplierId) return null;
  const payoutBase = order.sellerNetKes ?? order.sourcePriceKes;
  if (!payoutBase) return null;
  load();

  const existing = store.entries.find((e) => e.orderId === order.id && e.status !== "cancelled");
  if (existing) return existing;

  const eligibleAt = order.payoutEligibleAt || addBusinessDays(Date.now(), 3);
  const entry = buildPayoutEntry(order, { status: "scheduled", payoutEligibleAt: eligibleAt });
  store.entries.unshift(entry);
  if (store.entries.length > 500) store.entries.length = 500;
  persist();
  return entry;
}

/** Promote scheduled payouts whose hold period has elapsed. */
export function processDuePayouts() {
  load();
  const now = Date.now();
  let promoted = 0;
  for (const entry of store.entries) {
    if (entry.status !== "scheduled") continue;
    if (!entry.payoutEligibleAt || entry.payoutEligibleAt > now) continue;
    try {
      const order = getOrder(entry.orderId);
      if (order?.disputeHold || order?.escrowStatus === "refunded") continue;
    } catch {
      /* ignore */
    }
    entry.status = "owed";
    promoted += 1;
  }
  if (promoted) persist();
  return promoted;
}

/** Record supplier payout owed immediately (legacy / manual). */
export function recordDeliveryPayout(order) {
  if (!order?.supplierId || !order.sourcePriceKes) return null;
  load();

  const existing = store.entries.find((e) => e.orderId === order.id && e.status !== "cancelled");
  if (existing) return existing;

  const entry = buildPayoutEntry(order, { status: "owed", payoutEligibleAt: null });
  store.entries.unshift(entry);
  if (store.entries.length > 500) store.entries.length = 500;
  persist();
  return entry;
}

export function listOwedPayouts(limit = 20) {
  load();
  return store.entries.filter((e) => e.status === "owed").slice(0, limit);
}

export function listScheduledPayouts(limit = 20) {
  load();
  return store.entries.filter((e) => e.status === "scheduled").slice(0, limit);
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

export function cancelSettlementPayout(orderId, reason = "dispute") {
  load();
  const entry = store.entries.find(
    (e) => e.orderId === orderId && (e.status === "scheduled" || e.status === "owed")
  );
  if (!entry) return null;
  entry.status = "cancelled";
  entry.cancelledAt = Date.now();
  entry.cancelReason = reason;
  persist();
  return entry;
}

export function reinstateSettlementPayout(orderId) {
  load();
  const entry = store.entries.find((e) => e.orderId === orderId && e.status === "cancelled");
  if (!entry) return null;
  const eligibleAt = entry.payoutEligibleAt || addBusinessDays(Date.now(), 1);
  entry.status = "scheduled";
  entry.payoutEligibleAt = eligibleAt;
  entry.reinstatedAt = Date.now();
  delete entry.cancelReason;
  persist();
  return entry;
}

export function getSettlementSummary() {
  load();
  const owed = store.entries.filter((e) => e.status === "owed");
  const scheduled = store.entries.filter((e) => e.status === "scheduled");
  const totalOwed = owed.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  const totalScheduled = scheduled.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  return {
    count: owed.length,
    scheduledCount: scheduled.length,
    totalOwedKes: totalOwed,
    totalScheduledKes: totalScheduled,
    entries: owed,
  };
}
