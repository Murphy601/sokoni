import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getSupplier } from "./suppliers.js";
import { orderBuyerTotal, resolveSellerPayoutKes } from "./shipping-tiers.js";
import { getOrder, updateOrderMeta, listAllOrders } from "./orders.js";
import { config } from "../config.js";

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
  const payoutAmountKes = resolveSellerPayoutKes(order) || Math.round(buyerTotal * 0.9);
  return {
    id: `PAY-${order.id}`,
    orderId: order.id,
    supplierId: order.supplierId,
    supplierName: supplier?.businessName || order.supplierId,
    supplierPhone: supplier?.phone || "",
    mpesaPhone: supplier?.mpesaNumber || supplier?.phone || "",
    productName: order.productName,
    payoutAmountKes,
    marginKes: order.platformFeeKes ?? Math.max(0, buyerTotal - payoutAmountKes),
    retailKes: buyerTotal,
    itemKes: order.priceKes,
    shippingKes: order.shippingKes ?? 0,
    shippingRecipient: order.shippingRecipient || "platform",
    deliveryMethod: order.deliveryMethod || "hub",
    status,
    createdAt: Date.now(),
    deliveredAt: Date.now(),
    payoutEligibleAt,
    paidAt: null,
    b2c: null,
  };
}

/**
 * Schedule seller payout 3 business days after delivery (Depop-style escrow release).
 * Pass refreshEligibleAt when an admin/dispute override needs to pull forward eligibility.
 */
export function scheduleSellerPayoutAfterDelivery(order, { refreshEligibleAt = false } = {}) {
  if (!order?.supplierId) return null;
  const payoutBase = resolveSellerPayoutKes(order);
  if (!payoutBase) return null;
  load();

  const existing = store.entries.find((e) => e.orderId === order.id && e.status !== "cancelled");
  if (existing) {
    if (
      refreshEligibleAt &&
      order.payoutEligibleAt != null &&
      (existing.status === "scheduled" || existing.status === "owed")
    ) {
      const nextEligible = Number(order.payoutEligibleAt) || Date.now();
      if (!existing.payoutEligibleAt || nextEligible < existing.payoutEligibleAt) {
        existing.payoutEligibleAt = nextEligible;
      }
      if (payoutBase > 0) existing.payoutAmountKes = payoutBase;
      existing.refreshedAt = Date.now();
      persist();
    }
    return existing;
  }

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

/**
 * Admin / dispute Release → Ready for M-Pesa immediately (status=owed).
 * Never leave released funds stuck as scheduled (or miscounted as pending escrow).
 */
export function markSettlementReadyForMpesa(order, { payoutAmountKes = null } = {}) {
  if (!order?.id || !order?.supplierId) return null;
  load();

  const amount =
    Math.round(Number(payoutAmountKes)) ||
    resolveSellerPayoutKes(order) ||
    Math.round(Number(order.sellerNetKes ?? order.sourcePriceKes) || 0);
  if (!amount) return null;

  const existing = store.entries.find(
    (e) => e.orderId === order.id && e.status !== "cancelled" && e.status !== "paid"
  );
  if (existing) {
    // Already sending / already ready — just refresh amount if needed.
    if (existing.status === "disbursing") {
      if (amount > 0) existing.payoutAmountKes = amount;
      persist();
      return existing;
    }
    existing.status = "owed";
    existing.payoutEligibleAt = Date.now();
    existing.payoutAmountKes = amount;
    existing.readyForMpesaAt = Date.now();
    persist();
    return existing;
  }

  const entry = buildPayoutEntry(
    { ...order, sellerPayoutKes: amount, sellerNetKes: amount, sourcePriceKes: amount },
    { status: "owed", payoutEligibleAt: Date.now() }
  );
  entry.readyForMpesaAt = Date.now();
  store.entries.unshift(entry);
  if (store.entries.length > 500) store.entries.length = 500;
  persist();
  return entry;
}

/**
 * Heal historical admin Releases that left funds as scheduled / missing.
 * Safe to call on every seller ledger / withdraw load.
 */
export function healReleasedSellerPayouts(supplierId) {
  if (!supplierId) return 0;
  let healed = 0;
  for (const order of listAllOrders()) {
    if (!order || order.supplierId !== supplierId) continue;
    if (order.kind === "cart_parent" || order.isPaidOut) continue;
    if (order.status === "cancelled") continue;
    const escrow = String(order.escrowStatus || "").toLowerCase();
    if (escrow === "refunded") continue;
    const released =
      escrow === "released" ||
      Boolean(order.escrowReleasedAt) ||
      String(order.payoutStatus || "").toLowerCase() === "owed";
    if (!released) continue;
    const entry = markSettlementReadyForMpesa(order);
    if (entry && (entry.status === "owed" || entry.status === "disbursing")) healed += 1;
  }
  return healed;
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

export function listDisbursingPayouts(limit = 20) {
  load();
  return store.entries.filter((e) => e.status === "disbursing").slice(0, limit);
}

export function findSettlementByOrderId(orderId) {
  load();
  return (
    store.entries.find(
      (e) =>
        e.orderId === orderId &&
        (e.status === "owed" ||
          e.status === "disbursing" ||
          e.status === "scheduled" ||
          e.status === "b2c_failed")
    ) || null
  );
}

export function findSettlementByOriginatorId(originatorConversationId) {
  load();
  const oid = String(originatorConversationId || "").trim();
  if (!oid) return null;
  return (
    store.entries.find((e) => e.b2c?.originatorConversationId === oid) ||
    store.entries.find((e) => e.b2c?.conversationId === oid) ||
    null
  );
}

export function markPayoutPaid(orderId, extra = {}) {
  load();
  const entry = store.entries.find(
    (e) =>
      e.orderId === orderId &&
      (e.status === "owed" || e.status === "disbursing" || e.status === "b2c_failed")
  );
  if (!entry) return null;
  entry.status = "paid";
  entry.paidAt = Date.now();
  if (extra.receipt) entry.mpesaReceipt = extra.receipt;
  if (extra.b2c) entry.b2c = { ...(entry.b2c || {}), ...extra.b2c, completedAt: Date.now() };
  persist();
  return entry;
}

/**
 * Start B2C for one owed (or failed) settlement. Marks disbursing on accept.
 */
export async function initiateSettlementB2C(orderId, { force = false } = {}) {
  load();
  const entry = store.entries.find((e) => e.orderId === orderId);
  if (!entry) return { error: "not_found", message: `No settlement for ${orderId}` };
  if (entry.status === "paid") return { skipped: true, message: "Already paid." };
  if (entry.status === "cancelled") return { error: "cancelled", message: "Settlement cancelled." };
  if (entry.status === "scheduled" && !force) {
    return { error: "still_held", message: "Still in escrow hold — wait until owed, or use force." };
  }
  if (entry.status === "disbursing" && !force) {
    return { skipped: true, message: "B2C already in flight — wait for ResultURL callback." };
  }

  const supplier = getSupplier(entry.supplierId);
  const mpesaPhone =
    entry.mpesaPhone || supplier?.mpesaNumber || supplier?.phone || entry.supplierPhone;
  if (!mpesaPhone) {
    return { error: "no_mpesa", message: "Seller M-Pesa number not on file." };
  }

  const attempt = Number(entry.b2c?.attempt || 0) + 1;
  const { initiateB2CPayout, isB2CReady, b2cOriginatorId } = await import("./daraja-mpesa.js");
  if (!isB2CReady()) {
    return {
      error: "b2c_not_configured",
      message: "B2C not configured on this bot yet.",
    };
  }

  const originatorConversationId = b2cOriginatorId({ orderId: entry.orderId, attempt });
  let result;
  try {
    result = await initiateB2CPayout({
      phone: mpesaPhone,
      amount: entry.payoutAmountKes,
      remarks: `Sokoni payout ${entry.orderId}`,
      occasion: entry.orderId,
      orderId: entry.orderId,
      originatorConversationId,
    });
  } catch (err) {
    result = { ok: false, message: err.message };
  }

  entry.mpesaPhone = mpesaPhone;
  entry.b2c = {
    ...(entry.b2c || {}),
    attempt,
    originatorConversationId: result.originatorConversationId || originatorConversationId,
    conversationId: result.conversationId || null,
    lastRequestAt: Date.now(),
    lastMessage: result.message || result.responseDescription || null,
  };

  if (result.ok) {
    entry.status = "disbursing";
    entry.b2c.acceptedAt = Date.now();
    persist();
    try {
      updateOrderMeta(entry.orderId, { payoutStatus: "disbursing" });
    } catch {
      /* ignore */
    }
    return { success: true, entry, result };
  }

  entry.status = "b2c_failed";
  entry.b2c.failedAt = Date.now();
  persist();
  try {
    updateOrderMeta(entry.orderId, { payoutStatus: "b2c_failed" });
  } catch {
    /* ignore */
  }
  import("./communication-hub.js")
    .then(({ notifyAdminEvent }) =>
      notifyAdminEvent("PAYOUT_FAILED", {
        orderId: entry.orderId,
        details: result.message || "B2C rejected — retry with #payb2c",
      })
    )
    .catch(() => {});
  return { error: "b2c_rejected", message: result.message || "B2C rejected", entry, result };
}

/** Apply Safaricom B2C ResultURL / timeout callback to a settlement. */
export function applyB2CResult(parsed) {
  if (!parsed?.valid) return { error: "invalid" };
  load();

  let entry =
    findSettlementByOriginatorId(parsed.originatorConversationId) ||
    (parsed.conversationId ? findSettlementByOriginatorId(parsed.conversationId) : null);

  if (!entry) {
    console.warn("[settlements] B2C result unmatched", {
      originator: parsed.originatorConversationId,
      conversation: parsed.conversationId,
    });
    return { error: "not_found" };
  }

  entry.b2c = {
    ...(entry.b2c || {}),
    conversationId: parsed.conversationId || entry.b2c?.conversationId,
    originatorConversationId:
      parsed.originatorConversationId || entry.b2c?.originatorConversationId,
    resultCode: parsed.resultCode,
    resultDesc: parsed.resultDesc,
    receipt: parsed.receipt || null,
    receiverPublicName: parsed.receiverPublicName || null,
    callbackAt: Date.now(),
    timeout: Boolean(parsed.timeout),
  };

  if (parsed.success) {
    entry.status = "paid";
    entry.paidAt = Date.now();
    entry.mpesaReceipt = parsed.receipt || entry.mpesaReceipt || null;
    persist();
    try {
      updateOrderMeta(entry.orderId, {
        payoutStatus: "paid",
        isPaidOut: true,
        paidOutAt: Date.now(),
        mpesaPayoutReceipt: parsed.receipt || null,
      });
    } catch {
      /* ignore */
    }
    console.log("[settlements] B2C paid", entry.orderId, parsed.receipt);
    return { success: true, entry };
  }

  entry.status = "b2c_failed";
  persist();
  try {
    updateOrderMeta(entry.orderId, { payoutStatus: "b2c_failed" });
  } catch {
    /* ignore */
  }
  console.warn("[settlements] B2C failed", entry.orderId, parsed.resultDesc);
  return { success: false, entry, resultDesc: parsed.resultDesc };
}

/**
 * Auto-disburse owed settlements when MPESA_B2C_AUTO=true.
 * @returns {Promise<number>} number of B2C requests accepted
 */
export async function disburseOwedPayoutsViaB2C({ includeFailed = false, limit = 10 } = {}) {
  if (!config.mpesa.b2cAuto) return 0;
  const { isB2CReady } = await import("./daraja-mpesa.js");
  if (!isB2CReady()) return 0;

  load();
  const candidates = store.entries
    .filter((e) => e.status === "owed" || (includeFailed && e.status === "b2c_failed"))
    .slice(0, limit);

  let accepted = 0;
  for (const entry of candidates) {
    const out = await initiateSettlementB2C(entry.orderId);
    if (out.success) accepted += 1;
  }
  return accepted;
}

export function cancelSettlementPayout(orderId, reason = "dispute") {
  load();
  const entry = store.entries.find(
    (e) =>
      e.orderId === orderId &&
      (e.status === "scheduled" ||
        e.status === "owed" ||
        e.status === "disbursing" ||
        e.status === "b2c_failed")
  );
  if (!entry) return null;
  entry.status = "cancelled";
  entry.cancelledAt = Date.now();
  entry.cancelReason = reason;
  persist();
  return entry;
}

export function reinstateSettlementPayout(orderId, { payoutEligibleAt = null } = {}) {
  load();
  const entry = store.entries.find((e) => e.orderId === orderId && e.status === "cancelled");
  if (!entry) return null;
  const eligibleAt =
    payoutEligibleAt != null
      ? Number(payoutEligibleAt) || Date.now()
      : entry.payoutEligibleAt || addBusinessDays(Date.now(), 1);
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
  const disbursing = store.entries.filter((e) => e.status === "disbursing");
  const failed = store.entries.filter((e) => e.status === "b2c_failed");
  const totalOwed = owed.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  const totalScheduled = scheduled.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  return {
    count: owed.length,
    scheduledCount: scheduled.length,
    disbursingCount: disbursing.length,
    failedCount: failed.length,
    totalOwedKes: totalOwed,
    totalScheduledKes: totalScheduled,
    entries: owed,
    disbursing,
    failed,
  };
}
