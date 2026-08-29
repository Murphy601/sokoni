import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
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
let loadedMtimeMs = 0;

function fileMtimeMs(file) {
  try {
    return existsSync(file) ? statSync(file).mtimeMs : 0;
  } catch {
    return 0;
  }
}

function load() {
  const mtime = fileMtimeMs(SETTLEMENTS_FILE);
  // Re-read when ops scripts rewrite the file on disk (mtime change).
  if (loaded && mtime === loadedMtimeMs) return;
  loaded = true;
  loadedMtimeMs = mtime;
  try {
    if (existsSync(SETTLEMENTS_FILE)) {
      store = { entries: [], ...JSON.parse(readFileSync(SETTLEMENTS_FILE, "utf-8")) };
    } else {
      store = { entries: [] };
    }
  } catch (err) {
    console.error("[settlements] failed to load:", err.message);
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SETTLEMENTS_FILE, JSON.stringify(store, null, 2));
    loadedMtimeMs = fileMtimeMs(SETTLEMENTS_FILE);
  } catch (err) {
    console.error("[settlements] failed to persist:", err.message);
  }
}

function isFailedPayoutStatus(status) {
  return status === "b2c_failed" || status === "paystack_failed";
}

function isWithdrawableStatus(status) {
  return status === "owed" || isFailedPayoutStatus(status);
}

function isLockedPayoutStatus(status) {
  return status === "disbursing" || status === "withdraw_queued";
}

function isOpenSettlementStatus(status) {
  return (
    status === "owed" ||
    status === "disbursing" ||
    status === "withdraw_queued" ||
    status === "scheduled" ||
    isFailedPayoutStatus(status)
  );
}

function nairobiDayStartMs(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return new Date(`${year}-${month}-${day}T00:00:00+03:00`).getTime();
}

/** Add N business days (Mon–Fri) in Africa/Nairobi calendar. */
export function addBusinessDays(fromMs, days) {
  const n = Math.max(0, Math.floor(Number(days) || 0));
  if (n === 0) return fromMs;
  let d = new Date(fromMs);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d.getTime();
}

/** Configured escrow hold (0 = instant Ready for M-Pesa on delivery). */
export function escrowHoldBusinessDays() {
  const n = Number(config.mpesa?.escrowHoldBusinessDays);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
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
 * Schedule seller payout after delivery (hold days from ESCROW_HOLD_BUSINESS_DAYS).
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

  const holdDays = escrowHoldBusinessDays();
  const eligibleAt =
    order.payoutEligibleAt != null
      ? Number(order.payoutEligibleAt)
      : addBusinessDays(Date.now(), holdDays);
  const entry = buildPayoutEntry(order, { status: "scheduled", payoutEligibleAt: eligibleAt });
  store.entries.unshift(entry);
  if (store.entries.length > 500) store.entries.length = 500;
  persist();
  return entry;
}

/**
 * After delivery / buyer confirm: credit Seller Hub Ready for M-Pesa.
 * Hold days 0 → owed immediately; otherwise scheduled until processDuePayouts.
 */
export function creditSellerWalletAfterDelivery(order, { payoutAmountKes = null } = {}) {
  if (!order?.id || !order?.supplierId) return null;
  const holdDays = escrowHoldBusinessDays();
  const amount =
    Math.round(Number(payoutAmountKes)) ||
    resolveSellerPayoutKes(order) ||
    Math.round(Number(order.sellerNetKes ?? order.sourcePriceKes) || 0);
  if (!amount) return null;

  const eligibleAt = holdDays === 0 ? Date.now() : addBusinessDays(Date.now(), holdDays);
  const patched = {
    ...order,
    sellerNetKes: order.sellerNetKes ?? amount,
    sellerPayoutKes: order.sellerPayoutKes ?? amount,
    sourcePriceKes: order.sourcePriceKes ?? amount,
    payoutEligibleAt: eligibleAt,
  };

  scheduleSellerPayoutAfterDelivery(patched, { refreshEligibleAt: true });
  if (holdDays === 0) {
    processDuePayouts();
    return markSettlementReadyForMpesa(patched, { payoutAmountKes: amount });
  }
  return findSettlementByOrderId(order.id);
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
    if (isLockedPayoutStatus(existing.status)) {
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
    if (entry && (entry.status === "owed" || isLockedPayoutStatus(entry.status))) healed += 1;
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
    store.entries.find((e) => e.orderId === orderId && isOpenSettlementStatus(e.status)) || null
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

/** Lock Ready lines so a queued admin payout cannot be withdrawn twice. */
export function lockSettlementsForAdminQueue(orderIds, { withdrawId = "" } = {}) {
  load();
  const want = new Set((orderIds || []).map((id) => String(id || "").toUpperCase()).filter(Boolean));
  if (!want.size) return 0;
  let locked = 0;
  for (const entry of store.entries) {
    if (!want.has(String(entry.orderId || "").toUpperCase())) continue;
    if (entry.status === "paid" || entry.status === "cancelled") continue;
    entry.status = "withdraw_queued";
    entry.withdrawQueuedAt = Date.now();
    entry.withdrawId = withdrawId || entry.withdrawId || null;
    locked += 1;
    try {
      updateOrderMeta(entry.orderId, { payoutStatus: "withdraw_queued", payoutRail: "admin" });
    } catch {
      /* ignore */
    }
  }
  if (locked) persist();
  return locked;
}

export function markPayoutPaid(orderId, extra = {}) {
  load();
  const entry = store.entries.find(
    (e) =>
      e.orderId === orderId &&
      (isWithdrawableStatus(e.status) || isLockedPayoutStatus(e.status))
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

export function isWithdrawableSettlementStatus(status) {
  return isWithdrawableStatus(status);
}

export function sellerPaystackVolumeTodayKes(supplierId, now = Date.now()) {
  if (!supplierId) return 0;
  load();
  const start = nairobiDayStartMs(now);
  let sum = 0;
  for (const entry of store.entries) {
    if (entry.supplierId !== supplierId) continue;
    const chunks = entry.paystack?.chunks || [];
    for (const chunk of chunks) {
      const at = Number(chunk.createdAt || entry.paystack?.lastRequestAt || 0);
      if (at < start) continue;
      const st = String(chunk.status || "").toLowerCase();
      if (st === "success" || st === "pending" || st === "otp" || st === "received") {
        sum += Number(chunk.amountKes) || 0;
      }
    }
  }
  return sum;
}

export function findSettlementByPaystackReference(reference) {
  load();
  const ref = String(reference || "").trim().toLowerCase();
  if (!ref) return null;
  return (
    store.entries.find((e) => {
      const chunks = e.paystack?.chunks || [];
      return chunks.some((c) => String(c.reference || "").toLowerCase() === ref);
    }) ||
    store.entries.find((e) => String(e.paystack?.reference || "").toLowerCase() === ref) ||
    null
  );
}

async function ensurePaystackRecipient(supplier) {
  const phone = supplier?.mpesaNumber || supplier?.phone;
  const storedPhone = supplier?.paystackRecipientPhone;
  const storedCode = supplier?.paystackRecipientCode;
  if (storedCode && storedPhone && storedPhone === phone) {
    return { ok: true, recipientCode: storedCode, reused: true };
  }
  const { createMpesaRecipient } = await import("./paystack-transfers.js");
  const created = await createMpesaRecipient({
    name: supplier?.businessName || supplier?.contactName || supplier?.id,
    phone,
    metadata: { supplierId: supplier?.id || "" },
  });
  if (!created.ok) return created;
  const { saveSupplierPaystackRecipient } = await import("./suppliers.js");
  saveSupplierPaystackRecipient(supplier.id, {
    recipientCode: created.recipientCode,
    phone,
  });
  return created;
}

/**
 * Lock Ready line, then send Paystack transfer(s) to the seller M-Pesa.
 * Splits amounts over KES 250,000. Webhook marks paid or refunds the line.
 */
export async function initiateSettlementPaystack(orderId, { force = false, withdrawId = "" } = {}) {
  load();
  const entry = store.entries.find((e) => e.orderId === orderId);
  if (!entry) return { error: "not_found", message: `No settlement for ${orderId}` };
  if (entry.status === "paid") return { skipped: true, message: "Already paid." };
  if (entry.status === "cancelled") return { error: "cancelled", message: "Settlement cancelled." };
  if (entry.status === "scheduled" && !force) {
    return { error: "still_held", message: "Still in escrow hold — wait until owed, or use force." };
  }
  if (entry.status === "disbursing" && !force) {
    return { skipped: true, message: "Payout already in flight — wait for Paystack webhook." };
  }

  const { getSupplier } = await import("./suppliers.js");
  const supplier = getSupplier(entry.supplierId);
  const mpesaPhone =
    entry.mpesaPhone || supplier?.mpesaNumber || supplier?.phone || entry.supplierPhone;
  if (!mpesaPhone) {
    return { error: "no_mpesa", message: "Seller M-Pesa number not on file." };
  }

  const {
    isPaystackReady,
    splitMpesaTransferChunks,
    paystackReference,
    initiateKesTransfer,
    remainingMpesaDailyKes,
  } = await import("./paystack-transfers.js");
  if (!isPaystackReady()) {
    return { error: "paystack_not_configured", message: "Paystack secret key is not configured." };
  }

  const sentToday = sellerPaystackVolumeTodayKes(entry.supplierId);
  const dailyLeft = remainingMpesaDailyKes(sentToday);
  if (dailyLeft <= 0) {
    return {
      error: "mpesa_daily_cap",
      message: "M-Pesa daily cap of KES 500,000 already used today — try again tomorrow.",
    };
  }

  const amountKes = Math.round(Number(entry.payoutAmountKes) || 0);
  if (amountKes > dailyLeft) {
    return {
      error: "mpesa_daily_cap",
      message: `This payout (KES ${amountKes.toLocaleString()}) would pass the M-Pesa daily cap. KES ${dailyLeft.toLocaleString()} still available today.`,
    };
  }

  const recipient = await ensurePaystackRecipient(supplier || { mpesaNumber: mpesaPhone });
  if (!recipient.ok) {
    return { error: recipient.error || "recipient_failed", message: recipient.message };
  }

  const chunks = splitMpesaTransferChunks(amountKes);
  if (!chunks.length) {
    return { error: "invalid_amount", message: "Nothing to send." };
  }

  // Lock ledger BEFORE the external API call to prevent double-spend.
  entry.status = "disbursing";
  entry.mpesaPhone = mpesaPhone;
  entry.disburseLockedAt = Date.now();
  entry.paystack = {
    ...(entry.paystack || {}),
    recipientCode: recipient.recipientCode,
    withdrawId: withdrawId || entry.paystack?.withdrawId || null,
    lastRequestAt: Date.now(),
    chunks: chunks.map((amount, index) => ({
      amountKes: amount,
      reference: paystackReference({ withdrawId, orderId: entry.orderId, chunkIndex: index }),
      status: "pending",
      createdAt: Date.now(),
    })),
  };
  persist();
  try {
    updateOrderMeta(entry.orderId, { payoutStatus: "disbursing", payoutRail: "paystack" });
  } catch {
    /* ignore */
  }

  let accepted = 0;
  let failed = 0;
  for (const chunk of entry.paystack.chunks) {
    const result = await initiateKesTransfer({
      amountKes: chunk.amountKes,
      recipientCode: recipient.recipientCode,
      reason: `Sokoni payout ${entry.orderId}`,
      reference: chunk.reference,
    });
    chunk.lastMessage = result.message || result.error || null;
    chunk.transferCode = result.transferCode || null;
    chunk.status = result.ok ? result.status || "pending" : "failed";
    if (result.ok) {
      accepted += 1;
      if (result.reference) chunk.reference = result.reference;
    } else {
      failed += 1;
    }
  }

  if (accepted > 0) {
    persist();
    return { success: true, entry, accepted, failed };
  }

  const failMessage = entry.paystack.chunks?.[0]?.lastMessage || "Paystack transfer rejected";
  const { isPaystackStarterPayoutBlock } = await import("./paystack-transfers.js");
  if (isPaystackStarterPayoutBlock(failMessage)) {
    entry.status = "withdraw_queued";
    entry.withdrawQueuedAt = Date.now();
    entry.withdrawId = withdrawId || entry.withdrawId || null;
    entry.paystack.failedAt = Date.now();
    persist();
    try {
      updateOrderMeta(entry.orderId, { payoutStatus: "withdraw_queued", payoutRail: "admin" });
    } catch {
      /* ignore */
    }
    return {
      queued: true,
      error: "paystack_starter",
      message: failMessage,
      entry,
    };
  }

  entry.status = "paystack_failed";
  entry.paystack.failedAt = Date.now();
  persist();
  try {
    updateOrderMeta(entry.orderId, { payoutStatus: "paystack_failed" });
  } catch {
    /* ignore */
  }
  import("./communication-hub.js")
    .then(({ notifyAdminEvent }) =>
      notifyAdminEvent("PAYOUT_FAILED", {
        orderId: entry.orderId,
        details: failMessage,
      })
    )
    .catch(() => {});
  return {
    error: "paystack_rejected",
    message: failMessage,
    entry,
  };
}

/** Apply Paystack transfer.success / failed / reversed to a locked settlement. */
export function applyPaystackTransferEvent(parsed) {
  if (!parsed?.valid) return { error: "invalid" };
  load();

  const entry =
    findSettlementByPaystackReference(parsed.reference) ||
    store.entries.find(
      (e) =>
        parsed.transferCode &&
        (e.paystack?.chunks || []).some((c) => c.transferCode === parsed.transferCode)
    ) ||
    null;

  if (!entry) {
    console.warn("[settlements] Paystack transfer unmatched", {
      reference: parsed.reference,
      transferCode: parsed.transferCode,
      event: parsed.event,
    });
    return { error: "not_found" };
  }

  const chunks = entry.paystack?.chunks || [];
  const chunk =
    chunks.find((c) => String(c.reference || "").toLowerCase() === String(parsed.reference || "").toLowerCase()) ||
    chunks.find((c) => parsed.transferCode && c.transferCode === parsed.transferCode) ||
    chunks[0];
  if (chunk) {
    chunk.status = parsed.success ? "success" : "failed";
    chunk.callbackAt = Date.now();
    chunk.transferCode = parsed.transferCode || chunk.transferCode;
    if (parsed.reversed) chunk.reversed = true;
  }
  entry.paystack = {
    ...(entry.paystack || {}),
    lastEvent: parsed.event,
    lastCallbackAt: Date.now(),
  };

  const allSuccess = chunks.length > 0 && chunks.every((c) => c.status === "success");
  const anyPending = chunks.some((c) =>
    ["pending", "otp", "received"].includes(String(c.status || "").toLowerCase())
  );
  const paidKes = chunks
    .filter((c) => c.status === "success")
    .reduce((s, c) => s + (Number(c.amountKes) || 0), 0);
  const unpaidKes = chunks
    .filter((c) => c.status !== "success")
    .reduce((s, c) => s + (Number(c.amountKes) || 0), 0);

  if (allSuccess) {
    entry.status = "paid";
    entry.paidAt = Date.now();
    persist();
    try {
      updateOrderMeta(entry.orderId, {
        payoutStatus: "paid",
        isPaidOut: true,
        paidOutAt: Date.now(),
        payoutRail: "paystack",
        paystackReference: parsed.reference || null,
      });
    } catch {
      /* ignore */
    }
    console.log("[settlements] Paystack paid", entry.orderId, parsed.reference);
    return { success: true, entry };
  }

  if (!anyPending && unpaidKes > 0) {
    // Refund only the failed remainder — never re-open money already confirmed paid.
    entry.payoutAmountKes = unpaidKes;
    entry.paystack.paidKes = (Number(entry.paystack.paidKes) || 0) + paidKes;
    entry.status = paidKes > 0 ? "owed" : "paystack_failed";
    persist();
    try {
      updateOrderMeta(entry.orderId, {
        payoutStatus: entry.status === "owed" ? "owed" : "paystack_failed",
        isPaidOut: false,
      });
    } catch {
      /* ignore */
    }
    console.warn("[settlements] Paystack partial/fail", entry.orderId, {
      paidKes,
      unpaidKes,
      event: parsed.event,
    });
    return { success: false, entry, refunded: true, partial: paidKes > 0 };
  }

  persist();
  return { success: Boolean(parsed.success), pending: true, entry };
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
    .filter((e) => e.status === "owed" || (includeFailed && isFailedPayoutStatus(e.status)))
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
  const entry = store.entries.find((e) => e.orderId === orderId && isOpenSettlementStatus(e.status));
  if (!entry) return null;
  entry.status = "cancelled";
  entry.cancelledAt = Date.now();
  entry.cancelReason = reason;
  persist();
  return entry;
}

/** Shrink an open settlement line after a seller partial refund (does not cancel). */
export function adjustSettlementPayoutAmount(orderId, newAmountKes) {
  load();
  const amt = Math.round(Number(newAmountKes));
  if (!orderId || !Number.isFinite(amt) || amt < 0) return null;
  const entry = store.entries.find((e) => e.orderId === orderId && isOpenSettlementStatus(e.status));
  if (!entry) return null;
  entry.payoutAmountKes = amt;
  entry.amountKes = amt;
  entry.partialAdjustedAt = Date.now();
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
  const queued = store.entries.filter((e) => e.status === "withdraw_queued");
  const failed = store.entries.filter((e) => isFailedPayoutStatus(e.status));
  const totalOwed = owed.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  const totalScheduled = scheduled.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  const totalQueued = queued.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  return {
    count: owed.length,
    scheduledCount: scheduled.length,
    disbursingCount: disbursing.length,
    queuedCount: queued.length,
    failedCount: failed.length,
    totalOwedKes: totalOwed,
    totalScheduledKes: totalScheduled,
    totalQueuedKes: totalQueued,
    entries: owed,
    disbursing,
    queued,
    failed,
  };
}
