/**
 * Order-state communication hub (WAHA).
 *
 * Lifecycle: PAY → DISPATCH SKN-####(-n)|SK-#### → YES … → escrow release path.
 * HELP → ADMIN_TAKE_OVER (bot silent relay to admin).
 *
 * Stack: JSON orders + WAHA (not Twilio / Mongo / Socket.io).
 */
import { config } from "../config.js";
import { sendText, toChatId, phoneDigitsFromChatId } from "./whatsapp.js";
import {
  getOrder,
  getOrdersForCustomer,
  getContactPhone,
  listAllOrders,
  updateOrderMeta,
  normalizeOrderId,
  extractOrderIdFromText,
  ORDER_ID_CAPTURE,
} from "./orders.js";
import { findSupplierByPhone, getSupplier, listSuppliers } from "./suppliers.js";
import { advanceShipmentStatus, getEffectiveShipmentStatus } from "./shipments.js";
import { formatLandmarkLine } from "../lib/landmark-hubs.js";
import { setHumanHandoff, clearHumanHandoff, getCustomerMeta } from "./session.js";
import {
  registerSellerChatId,
  getSellerPhoneForChatId,
  listChatIdsForSellerPhone,
  rememberSellerNotifyTarget,
} from "./seller-chat-ids.js";

const HOUR_MS = 60 * 60 * 1000;
const DISPATCH_REMIND_1 = 6 * HOUR_MS;
const DISPATCH_REMIND_2 = 12 * HOUR_MS;
const CONFIRM_REMIND_12H = 12 * HOUR_MS;
const CONFIRM_AUTO_RELEASE_24H = 24 * HOUR_MS;
const SUPPORT_THREAD_MAX = 80;

function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  if (!d.startsWith("254") && d.length >= 9) d = `254${d}`;
  return d;
}

function phonesMatch(a, b) {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (!x || !y) return false;
  return x === y || x.slice(-9) === y.slice(-9);
}

function orderIdOrEmpty(raw) {
  return normalizeOrderId(raw) || "";
}

export function buyerOwnsOrder(order, customerKey, phone) {
  if (!order) return false;
  if (order.customerKey && order.customerKey === customerKey) return true;
  const want = normalizePhone(phone);
  if (!want) return false;
  if (phonesMatch(order.phone, want) || phonesMatch(order.mpesaPhone, want)) return true;
  const keyDigits = String(order.customerKey || "").replace(/\D/g, "");
  if (keyDigits && phonesMatch(keyDigits, want)) return true;
  return getOrdersForCustomer(customerKey, phone).some((o) => o.id === order.id);
}

/**
 * Recover seller phone when WAHA sends @lid (no digits in chatId).
 * Order: webhook phone → chat registry → session meta → contacts → @c.us digits.
 */
export function resolveInboundSellerPhone(phone = "", customerKey = "") {
  const candidates = [
    phone,
    getSellerPhoneForChatId(customerKey),
    getCustomerMeta(customerKey)?.phone,
    getContactPhone(customerKey),
    phoneDigitsFromChatId(customerKey),
  ];
  for (const c of candidates) {
    const n = normalizePhone(c);
    if (n && n.length >= 9) return n;
  }
  return "";
}

function supplierMatchesSender(supplier, phone = "", customerKey = "") {
  if (!supplier) return false;
  const resolved = resolveInboundSellerPhone(phone, customerKey) || normalizePhone(phone);
  if (resolved && (phonesMatch(resolved, supplier.phone) || phonesMatch(resolved, supplier.mpesaNumber))) {
    return true;
  }
  if (customerKey) {
    // Bound during onboarding / OTP / vendor menu (covers @lid).
    if (supplier.whatsappChatId && supplier.whatsappChatId === customerKey) return true;
    if (
      Array.isArray(supplier.whatsappChatIds) &&
      supplier.whatsappChatIds.includes(customerKey)
    ) {
      return true;
    }
    if (supplier.phone && toChatId(supplier.phone) === customerKey) return true;
    if (supplier.mpesaNumber && toChatId(supplier.mpesaNumber) === customerKey) return true;
    const keyDigits = String(customerKey || "").replace(/\D/g, "");
    if (keyDigits && (phonesMatch(keyDigits, supplier.phone) || phonesMatch(keyDigits, supplier.mpesaNumber))) {
      return true;
    }
  }
  return false;
}

/**
 * Seller ownership: prefer the order's supplier record (phone or M-Pesa),
 * not "find any supplier by inbound phone then compare ids".
 */
export function sellerOwnsOrder(order, phone, customerKey = "") {
  if (!order) return false;
  const resolved = resolveInboundSellerPhone(phone, customerKey) || normalizePhone(phone);

  if (order.supplierId) {
    const onOrder = getSupplier(order.supplierId);
    if (supplierMatchesSender(onOrder, resolved || phone, customerKey)) return true;
  }

  // Fallback: inbound phone → supplier id must still equal order.supplierId.
  const byPhone = resolved ? findSupplierByPhone(resolved) : findSupplierByPhone(phone);
  if (byPhone && order.supplierId && byPhone.id === order.supplierId) {
    if (customerKey && (byPhone.phone || resolved)) {
      registerSellerChatId(customerKey, byPhone.phone || resolved);
    }
    return true;
  }

  return false;
}

function normalizeHandle(raw) {
  return String(raw || "")
    .replace(/^@+/, "")
    .trim()
    .toLowerCase();
}

function findSupplierForSender(phone = "", customerKey = "") {
  const resolved = resolveInboundSellerPhone(phone, customerKey);
  const byPhone = resolved ? findSupplierByPhone(resolved) : phone ? findSupplierByPhone(phone) : null;
  if (byPhone) {
    if (customerKey && (byPhone.phone || resolved)) {
      registerSellerChatId(customerKey, byPhone.phone || resolved);
    }
    return byPhone;
  }
  // Onboarding-bound @lid / chat — works even when WAHA sends no phone digits.
  if (customerKey) {
    const byChat =
      listSuppliers().find(
        (s) =>
          s.whatsappChatId === customerKey ||
          (Array.isArray(s.whatsappChatIds) && s.whatsappChatIds.includes(customerKey))
      ) || null;
    if (byChat) {
      if (byChat.phone) registerSellerChatId(customerKey, byChat.phone);
      return byChat;
    }
  }
  const match = listSuppliers().find((s) => supplierMatchesSender(s, resolved || phone, customerKey)) || null;
  if (match && customerKey && match.phone) {
    registerSellerChatId(customerKey, match.phone);
  }
  return match;
}

/** Chat targets for seller WhatsApp (primary @c.us + onboarding-linked chats). */
export function sellerNotifyTargets(phone) {
  const primary = rememberSellerNotifyTarget(phone);
  const linked = listChatIdsForSellerPhone(phone);
  const supplier = phone ? findSupplierByPhone(phone) : null;
  const fromSupplier = [
    supplier?.whatsappChatId,
    ...(Array.isArray(supplier?.whatsappChatIds) ? supplier.whatsappChatIds : []),
  ].filter(Boolean);
  for (const id of fromSupplier) {
    if (phone) registerSellerChatId(id, phone);
  }
  const out = [];
  const seen = new Set();
  for (const id of [primary, ...linked, ...fromSupplier]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function supplierPhoneLast4(supplier) {
  const digits = normalizePhone(supplier?.phone) || normalizePhone(supplier?.mpesaNumber);
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function productBelongsToSupplier(product, supplier) {
  if (!product || !supplier) return false;
  if (product.supplierId && product.supplierId === supplier.id) return true;
  if (product.sellerPhone && phonesMatch(product.sellerPhone, supplier.phone)) return true;
  if (product.sellerPhone && phonesMatch(product.sellerPhone, supplier.mpesaNumber)) return true;
  const ph = normalizeHandle(product.shopHandle || product.sellerHandle);
  const sh = normalizeHandle(supplier.shopHandle || supplier.businessName);
  if (ph && sh && ph === sh) return true;
  return false;
}

/** Backfill supplierId from product when missing / broken. */
export async function ensureOrderSupplier(order) {
  if (!order?.id) return order;
  if (order.supplierId && getSupplier(order.supplierId)) return order;
  if (!order.productId) return order;
  try {
    const { getProductById } = await import("./catalog.js");
    const product = await getProductById(order.productId);
    let sid = product?.supplierId || null;
    if (!sid && product?.sellerPhone) {
      sid = findSupplierByPhone(product.sellerPhone)?.id || null;
    }
    if (sid) {
      updateOrderMeta(order.id, { supplierId: sid });
      return getOrder(order.id) || order;
    }
  } catch (err) {
    console.warn("[communication-hub] ensureOrderSupplier:", err.message);
  }
  return order;
}

/**
 * Authorize DISPATCH for the inbound WhatsApp seller.
 * Claims/repairs order.supplierId when the product clearly belongs to them.
 */
export async function authorizeSellerForOrder(order, phone = "", customerKey = "") {
  let o = (await ensureOrderSupplier(order)) || order;
  const resolvedPhone = resolveInboundSellerPhone(phone, customerKey);

  if (sellerOwnsOrder(o, resolvedPhone || phone, customerKey)) {
    const owner = o.supplierId ? getSupplier(o.supplierId) : findSupplierForSender(resolvedPhone || phone, customerKey);
    if (customerKey && owner?.phone) registerSellerChatId(customerKey, owner.phone);
    return { ok: true, order: o, resolvedPhone: resolvedPhone || null };
  }

  const inboundSeller = findSupplierForSender(resolvedPhone || phone, customerKey);
  if (!inboundSeller) {
    return {
      ok: false,
      order: o,
      reason: "not_registered_seller",
      resolvedPhone: resolvedPhone || null,
      needsLink: Boolean(customerKey?.includes("@lid") || !resolvedPhone),
    };
  }

  let product = null;
  if (o.productId) {
    try {
      const { getProductById } = await import("./catalog.js");
      product = await getProductById(o.productId);
    } catch (err) {
      console.warn("[communication-hub] product lookup:", err.message);
    }
  }

  const productTheirs = productBelongsToSupplier(product, inboundSeller);
  // Claim when the listing is theirs (even if order.supplierId was null/wrong).
  if (productTheirs || o.supplierId === inboundSeller.id) {
    if (o.supplierId !== inboundSeller.id) {
      console.log(
        `[communication-hub] claiming ${o.id} for seller ${inboundSeller.id} (was ${o.supplierId || "none"})`
      );
      updateOrderMeta(o.id, { supplierId: inboundSeller.id });
      o = getOrder(o.id) || o;
    }
    if (customerKey && inboundSeller.phone) registerSellerChatId(customerKey, inboundSeller.phone);
    return { ok: true, order: o, resolvedPhone: resolvedPhone || null };
  }

  return {
    ok: false,
    order: o,
    reason: "wrong_seller",
    inboundSellerId: inboundSeller.id,
    orderSupplierId: o.supplierId || null,
    productSupplierId: product?.supplierId || null,
    resolvedPhone: resolvedPhone || null,
  };
}

export function isPaidHeld(order) {
  return (
    order?.customerPaymentStatus === "confirmed" ||
    order?.escrowStatus === "held" ||
    order?.escrowStatus === "released"
  );
}

export function isDispatched(order) {
  if (!order) return false;
  if (order.sellerDispatchedAt) return true;
  const ship = getEffectiveShipmentStatus(order);
  return ["dropped_off", "in_transit", "at_pickup_point", "delivered"].includes(ship);
}

export function isAdminTakeOver(order) {
  return Boolean(order?.adminTakeOver || order?.supportStatus === "ADMIN_TAKE_OVER");
}

export function lifecycleLabel(order) {
  if (!order) return "UNKNOWN";
  if (isAdminTakeOver(order) || order.disputeHold) return "ADMIN_TAKE_OVER";
  if (order.status === "delivered" || order.shipmentStatus === "delivered") return "COMPLETED";
  if (isDispatched(order)) return "DISPATCHED";
  if (isPaidHeld(order)) return "HELD_IN_ESCROW";
  if (order.status === "awaiting_payment") return "AWAITING_PAYMENT";
  return String(order.status || "OPEN").toUpperCase();
}

export function dropOffLine(order) {
  const landmark = formatLandmarkLine(order);
  if (landmark) return landmark;
  return String(order?.location || "").trim() || "your drop-off point";
}

function appendSupportThread(orderId, entry) {
  const order = getOrder(orderId);
  if (!order) return;
  const thread = Array.isArray(order.supportThread) ? [...order.supportThread] : [];
  thread.push({ ...entry, at: entry.at || Date.now() });
  if (thread.length > SUPPORT_THREAD_MAX) thread.splice(0, thread.length - SUPPORT_THREAD_MAX);
  updateOrderMeta(orderId, { supportThread: thread, supportUpdatedAt: Date.now() });
}

function roleForSender(order, customerKey, phone) {
  if (buyerOwnsOrder(order, customerKey, phone)) return "BUYER";
  if (sellerOwnsOrder(order, phone, customerKey)) return "SELLER";
  return "USER";
}

/* -------------------------------------------------------------------------- */
/* Safe send + admin events                                                   */
/* -------------------------------------------------------------------------- */

export async function sendSafeWhatsApp(to, message) {
  if (!to || !message) return { success: false, error: "missing_to_or_message" };
  try {
    const result = await sendText(to, message);
    return { success: true, dryRun: Boolean(result?.dryRun) };
  } catch (err) {
    const error = err?.message || String(err);
    console.error(`[communication-hub] WhatsApp failed → ${to}:`, error);
    return { success: false, error };
  }
}

export function dispatchMessages(jobs = []) {
  return Promise.allSettled(
    jobs.filter((j) => j?.to && j?.message).map((j) => sendSafeWhatsApp(j.to, j.message))
  );
}

/**
 * Buyer + seller WhatsApp chat targets for an order.
 * @param {object} order
 * @param {{ sellerUserId?: number|null }} [opts] — dispute/order override when order.sellerUserId missing
 */
export async function getOrderPartyChats(order, opts = {}) {
  const buyer = [];
  const seller = [];
  if (!order) return { buyer, seller };
  if (order.customerKey) buyer.push(order.customerKey);
  if (!buyer.length) {
    const phone = order.phone || order.mpesaPhone || order.customerPhone;
    if (phone) {
      try {
        const chat = toChatId(phone);
        if (chat) buyer.push(chat);
      } catch {
        /* ignore */
      }
    }
  }

  try {
    const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
    if (supplier?.phone) {
      seller.push(...sellerNotifyTargets(supplier.phone));
    }
  } catch {
    /* ignore */
  }

  if (!seller.length) {
    try {
      const uid = Number(opts.sellerUserId ?? order.sellerUserId ?? order.seller_user_id);
      if (Number.isInteger(uid) && uid > 0) {
        const { query, isDbEnabled } = await import("../db/pool.js");
        if (isDbEnabled()) {
          const { rows } = await query(`SELECT phone FROM users WHERE id = $1 LIMIT 1`, [uid]);
          const phone = rows[0]?.phone;
          if (phone) seller.push(...sellerNotifyTargets(phone));
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    buyer: [...new Set(buyer.filter(Boolean))],
    seller: [...new Set(seller.filter(Boolean))],
  };
}

/**
 * Ping the other party on a support/dispute thread (never echoes to the sender).
 * @param {"BUYER"|"SELLER"|"ADMIN"|"USER"} fromRole
 */
export async function notifyCounterpart(order, fromRole, message, opts = {}) {
  if (!order || !message) return;
  const parties = await getOrderPartyChats(order, opts);
  const jobs = [];
  const role = String(fromRole || "").toUpperCase();
  if (role === "BUYER") {
    for (const to of parties.seller) jobs.push({ to, message });
  } else if (role === "SELLER") {
    for (const to of parties.buyer) jobs.push({ to, message });
  } else if (role === "ADMIN") {
    for (const to of [...parties.buyer, ...parties.seller]) jobs.push({ to, message });
  }
  if (jobs.length) void dispatchMessages(jobs);
}

/** Fan-out support/dispute WhatsApp to buyer and/or seller. */
export async function notifyOrderParties(
  order,
  { buyerMessage = null, sellerMessage = null, sellerUserId = null } = {}
) {
  if (!order) return;
  const parties = await getOrderPartyChats(order, { sellerUserId });
  const jobs = [];
  if (buyerMessage) {
    for (const to of parties.buyer) jobs.push({ to, message: buyerMessage });
  }
  if (sellerMessage) {
    for (const to of parties.seller) jobs.push({ to, message: sellerMessage });
  }
  if (jobs.length) void dispatchMessages(jobs);
}

export async function notifyAdminEvent(eventType, { orderId = null, details = "", silent = false } = {}) {
  console.log(`[ADMIN EVENT] [${eventType}]${orderId ? ` ${orderId}` : ""} | ${details}`);

  if (config.adminNotifyUrl) {
    try {
      await fetch(config.adminNotifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "order_event", eventType, orderId, details, at: Date.now() }),
      });
    } catch (err) {
      console.warn("[communication-hub] admin webhook failed:", err.message);
    }
  }

  if (silent || !config.admin.primary) return;

  const ping = new Set([
    "DISPUTE_OR_HELP",
    "DISPUTE_OPENED",
    "DISPUTE_SELLER_REPLY",
    "DISPUTE_EVIDENCE",
    "DISPUTE_RESOLVED",
    "ADMIN_TAKE_OVER",
    "SUPPORT_RELAY",
    "SUPPORT_CLOSED_BY_USER",
    "PAYOUT_FAILED",
    "CONFIRM_OVERDUE",
    "AUTO_RELEASED",
    "SELLER_DISPATCHED",
    "BUYER_CONFIRMED",
  ]);
  if (!ping.has(eventType)) return;

  // Relay messages already include full body — don't double-wrap SUPPORT_RELAY as alert style twice
  if (eventType === "SUPPORT_RELAY") {
    await sendSafeWhatsApp(config.admin.primary, details);
    return;
  }

  await sendSafeWhatsApp(
    config.admin.primary,
    `🛎️ *${eventType}*\n` +
      (orderId ? `Order: *${orderId}*\n` : "") +
      `${details}\n\n` +
      (orderId
        ? `Reply to user: *#${orderId} <message>*\nEnd takeover: *#done ${orderId}*`
        : `*#help* for admin commands`)
  );
}

/* -------------------------------------------------------------------------- */
/* Templates (expected lifecycle wording, SKN-#### / SK-####)                 */
/* -------------------------------------------------------------------------- */

export function msgSellerPaid(order) {
  const payout = order.sellerPayoutKes ?? order.sellerNetKes;
  const listingId = order.productId || order.supplierSku || null;
  return (
    `🎉 *New Paid Order on Sokoni!*\n` +
    `Order: *${order.id}*\n` +
    (listingId ? `Listing: *${listingId}*\n` : "") +
    `Item: *${order.productName || "Order"}*\n` +
    `Location: *${dropOffLine(order)}*\n` +
    (payout != null ? `Your payout after delivery: *KES ${Number(payout).toLocaleString()}*\n` : "") +
    `\nPlease pack the item. Once handed to the buyer/courier, reply:\n` +
    `*DISPATCH ${order.id}*\n\n` +
    `Problem? Reply: HELP ${order.id}`
  );
}

/**
 * One WhatsApp for a seller covering all their lines in a paid cart (SKN parent).
 * Includes listing id (e.g. hb-tlom7-003) + child tracking id (SKN-####-n).
 */
export function msgSellerCartPaid(parent, children = []) {
  const list = Array.isArray(children) ? children.filter(Boolean) : [];
  if (!list.length) return msgSellerPaid(parent);
  if (list.length === 1) return msgSellerPaid(list[0]);

  const parentId = parent?.id || list[0].parentOrderId || "SKN";
  const lines = list
    .map((c, i) => {
      const payout = c.sellerPayoutKes ?? c.sellerNetKes;
      const listingId = c.productId || c.supplierSku || "—";
      return (
        `${i + 1}. *${c.productName || "Item"}*\n` +
        `   Listing: *${listingId}*\n` +
        `   Tracking: *${c.id}*\n` +
        (payout != null ? `   Your payout: *KES ${Number(payout).toLocaleString()}*\n` : "") +
        `   When sent → *DISPATCH ${c.id}*`
      );
    })
    .join("\n\n");

  return (
    `🎉 *New Paid Cart Order on Sokoni!*\n` +
    `Cart: *${parentId}*\n` +
    `Your items (${list.length}):\n\n` +
    `${lines}\n\n` +
    `Location: *${dropOffLine(list[0])}*\n\n` +
    `Pack each item. Reply *DISPATCH* with that item's tracking ID when you hand it over.\n` +
    `Problem? Reply: HELP <tracking id>`
  );
}

export function msgBuyerPaid(order) {
  return (
    `✅ *Payment Confirmed for Order ${order.id}!*\n\n` +
    `Your payment is safely held in Sokoni Escrow.\n` +
    `The seller is preparing delivery to *${dropOffLine(order)}*.\n\n` +
    `*What happens next*\n` +
    `1. Seller sends the item → you get a dispatch update\n` +
    `2. When you receive & inspect it, reply:\n*YES ${order.id}*\n\n` +
    `Problem? Reply: HELP ${order.id}\n` +
    `Track: *${order.id}* or *track*`
  );
}

export function msgBuyerDispatched(order) {
  return (
    `📦 *Item Dispatched!*\n` +
    `Order *${order.id}* is en route to *${dropOffLine(order)}*.\n\n` +
    `Once received and inspected, reply:\n` +
    `*YES ${order.id}*\n` +
    `to release payment to the seller.\n\n` +
    `⚠️ Wrong/damaged item? Do *not* reply YES — reply:\nHELP ${order.id}`
  );
}

export function msgSellerDispatchAck(order) {
  return (
    `✅ *Status updated — ${order.id}*\n\n` +
    `We asked the buyer to confirm receipt upon inspection with:\n` +
    `*YES ${order.id}*`
  );
}

export function msgBuyerConfirmAck(order) {
  return (
    `🎉 *Thank you for shopping on Sokoni!*\n` +
    `Order *${order.id}* is complete. Seller payout is scheduled from escrow.\n\n` +
    `How would you rate your experience? Reply *1*–*5* or wait for the review prompt.`
  );
}

export function msgSellerBuyerConfirmed(order) {
  const payout = order.sellerPayoutKes ?? order.sellerNetKes;
  return (
    `💰 *Buyer confirmed receipt — ${order.id}*\n\n` +
    `Delivery recorded. ` +
    (payout != null
      ? `KES ${Number(payout).toLocaleString()} payout is scheduled from escrow (usually 2–3 business days).`
      : `Payout is scheduled from escrow (usually 2–3 business days).`) +
    `\n\nWallet: reply *balance*`
  );
}

export function msgHelpAck(order) {
  return (
    `🚨 *Sokoni Support Alerted*\n` +
    `Order *${order.id}* is paused (escrow frozen).\n` +
    `An admin has joined this chat. Type your message below — the bot stays quiet.\n\n` +
    `When you're finished with support, reply:\n*DONE*\n` +
    `(or *DONE ${order.id}*) — that closes support and turns the bot back on.`
  );
}

export function msgAutoReleasedBuyer(order) {
  return (
    `✅ *Order ${order.id} completed*\n\n` +
    `No confirmation arrived within 24 hours after dispatch, and no dispute was opened — ` +
    `we marked delivery complete and scheduled the seller payout.\n\n` +
    `If something was wrong, reply HELP ${order.id} urgently.`
  );
}

export function msgAutoReleasedSeller(order) {
  return (
    `💰 *Auto-complete — ${order.id}*\n\n` +
    `Buyer did not confirm within 24h and no dispute was open.\n` +
    `Delivery marked complete — payout follows the escrow hold.\n` +
    `Wallet: *balance*`
  );
}

/* -------------------------------------------------------------------------- */
/* Resolve / takeover helpers                                                 */
/* -------------------------------------------------------------------------- */

export function resolveActiveOrder({ customerKey, phone, text } = {}) {
  const fromText = extractOrderIdFromText(text);
  if (fromText) {
    const order = getOrder(fromText);
    if (order) return order;
  }

  const candidates = getOrdersForCustomer(customerKey, phone).filter(
    (o) => o.status !== "cancelled" && o.escrowStatus !== "refunded"
  );
  const takeOver = candidates.find((o) => isAdminTakeOver(o));
  if (takeOver) return takeOver;

  const open = candidates.find(
    (o) =>
      o.status !== "delivered" &&
      o.shipmentStatus !== "delivered" &&
      (isPaidHeld(o) || o.status === "awaiting_payment")
  );
  return open || candidates[0] || null;
}

function findTakeOverOrder(customerKey, phone) {
  const candidates = getOrdersForCustomer(customerKey, phone);
  return (
    candidates.find((o) => isAdminTakeOver(o) && o.status !== "cancelled") ||
    listAllOrders().find(
      (o) =>
        isAdminTakeOver(o) &&
        (buyerOwnsOrder(o, customerKey, phone) || sellerOwnsOrder(o, phone, customerKey))
    ) ||
    null
  );
}

async function startAdminTakeOver(order, { customerKey, phone, rawText, role }) {
  const { cancelSettlementPayout } = await import("./settlements.js");
  try {
    cancelSettlementPayout(order.id, "admin_take_over");
  } catch {
    /* ignore */
  }

  updateOrderMeta(order.id, {
    adminTakeOver: true,
    adminFlagged: true,
    adminFlaggedAt: Date.now(),
    adminFlagReason: String(rawText || "HELP").slice(0, 200),
    supportStatus: "ADMIN_TAKE_OVER",
    disputeHold: true,
    escrowStatus: "held",
    disputeFrozenAt: Date.now(),
    payoutStatus: "held_for_dispute",
  });

  appendSupportThread(order.id, {
    direction: "inbound",
    role,
    phone: phone || null,
    customerKey,
    text: String(rawText || "").slice(0, 1000),
  });

  // Pause bot for buyer + seller chats on this order.
  if (order.customerKey) {
    setHumanHandoff(order.customerKey, {
      startedAt: Date.now(),
      orderId: order.id,
      adminTakeOver: true,
      ackSent: true,
    });
  }
  setHumanHandoff(customerKey, {
    startedAt: Date.now(),
    orderId: order.id,
    adminTakeOver: true,
    ackSent: true,
  });
  const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
  if (supplier?.phone) {
    setHumanHandoff(toChatId(supplier.phone), {
      startedAt: Date.now(),
      orderId: order.id,
      adminTakeOver: true,
      ackSent: true,
    });
  }

  void notifyAdminEvent("ADMIN_TAKE_OVER", {
    orderId: order.id,
    details:
      `${role} requested help.\n` +
      `Phone: ${phone || "—"}\n` +
      `Said: "${String(rawText || "").slice(0, 160)}"\n` +
      `Escrow FROZEN. Bot is silent — messages relay here.\n` +
      `Reply: #${order.id} <message>\n` +
      `End: #done ${order.id}`,
  });

  // Alert the other party (buyer↔seller) — was missing before.
  const otherMsg =
    role === "BUYER"
      ? `⚠️ Buyer opened support on *${order.id}*. Escrow frozen. Admin is on the thread — reply here or wait for Sokoni.`
      : role === "SELLER"
        ? `⚠️ Seller opened support on *${order.id}*. Escrow frozen. Admin is on the thread — reply here or wait for Sokoni.`
        : `⚠️ Support opened on *${order.id}*. Escrow frozen. Admin will reply here.`;
  void notifyCounterpart(order, role, otherMsg);
}

/**
 * End ADMIN_TAKE_OVER — bot resumes; escrow unfreeze only if no open DB dispute.
 * Admin WhatsApp: *#done SKN-####* (alias *#resolve*). Buyer/seller: *DONE*.
 */
export async function resolveAdminTakeOver(orderId, { note = "", notifyParties = true } = {}) {
  const id = normalizeOrderId(orderId) || String(orderId || "").toUpperCase();
  const order = getOrder(id);
  if (!order) return { error: "not_found", message: "Order not found." };

  let keepDisputeHold = Boolean(order.disputeHold);
  try {
    const { orderHasOpenDispute } = await import("./disputes.js");
    keepDisputeHold = await orderHasOpenDispute(order.id);
  } catch {
    keepDisputeHold = false;
  }

  updateOrderMeta(order.id, {
    adminTakeOver: false,
    adminFlagged: false,
    supportStatus: null,
    adminResolvedAt: Date.now(),
    adminResolveNote: String(note || "").slice(0, 200) || null,
    disputeHold: keepDisputeHold,
    payoutStatus: keepDisputeHold ? "held_for_dispute" : order.payoutStatus === "held_for_dispute" ? "scheduled" : order.payoutStatus,
  });

  const parties = await getOrderPartyChats(order, {
    sellerUserId: order.sellerUserId || order.seller_user_id || null,
  });
  for (const chat of [...parties.buyer, ...parties.seller]) {
    clearHumanHandoff(chat);
  }
  // Also clear classic supplier chat id if not already covered.
  const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
  if (supplier?.phone) clearHumanHandoff(toChatId(supplier.phone));

  appendSupportThread(order.id, {
    direction: "system",
    role: "ADMIN",
    text: note ? `Takeover ended: ${note}` : "Takeover ended — bot resumed.",
  });

  const fresh = getOrder(order.id);
  if (notifyParties) {
    const buyerMsg = `✅ Support closed for *${fresh.id}*. Bot is active again. Type *${fresh.id}* to track.`;
    const sellerMsg = `✅ Support closed for *${fresh.id}*. Bot is active again.`;
    void notifyOrderParties(fresh, {
      buyerMessage: parties.buyer.length ? buyerMsg : null,
      sellerMessage: parties.seller.length ? sellerMsg : null,
      sellerUserId: fresh.sellerUserId || fresh.seller_user_id || null,
    });
  }

  return { ok: true, order: fresh, disputeHold: keepDisputeHold };
}

/** Admin dashboard / #SK reply — append outbound + ensure takeover. */
export function recordAdminOutbound(orderId, message, { setTakeOver = true } = {}) {
  const order = getOrder(orderId);
  if (!order) return null;
  if (setTakeOver && !isAdminTakeOver(order)) {
    updateOrderMeta(order.id, {
      adminTakeOver: true,
      adminFlagged: true,
      supportStatus: "ADMIN_TAKE_OVER",
    });
  }
  appendSupportThread(order.id, {
    direction: "outbound",
    role: "ADMIN",
    text: String(message || "").slice(0, 2000),
  });
  if (order.customerKey) {
    setHumanHandoff(order.customerKey, {
      startedAt: Date.now(),
      orderId: order.id,
      adminTakeOver: true,
      adminDirect: true,
      ackSent: true,
    });
  }
  return getOrder(order.id);
}

/* -------------------------------------------------------------------------- */
/* Silent relay (ADMIN_TAKE_OVER)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Buyer/seller ends support: DONE / END / CLOSE (optional SK).
 */
function isSupportDoneCommand(text) {
  const t = String(text || "").trim();
  return new RegExp(`^(DONE|END|CLOSE|BYE)\\b(?:\\s+${ORDER_ID_CAPTURE})?$`, "i").test(t);
}

/**
 * If sender is on an ADMIN_TAKE_OVER order, forward to admin and stay silent.
 * Exception: DONE/END/CLOSE closes takeover and resumes the bot.
 * @returns {Promise<boolean>}
 */
export async function tryRelayAdminTakeOver(customerKey, text, { phone = "" } = {}) {
  const order = findTakeOverOrder(customerKey, phone);
  if (!order) return false;

  const trimmed = String(text || "").trim();
  if (!trimmed) return true;

  const role = roleForSender(order, customerKey, phone);

  // Buyer/seller can end support without waiting for admin #done.
  if (isSupportDoneCommand(trimmed)) {
    if (role === "USER") {
      await sendSafeWhatsApp(
        customerKey,
        `*${order.id}* support is open, but this WhatsApp isn't the buyer/seller on the order.\nAsk them to reply *DONE*, or wait for admin.`
      );
      return true;
    }
    appendSupportThread(order.id, {
      direction: "inbound",
      role,
      phone: phone || null,
      customerKey,
      text: trimmed.slice(0, 200),
    });
    await resolveAdminTakeOver(order.id, { note: `${role} closed support with ${trimmed.split(/\s+/)[0]}` });
    clearHumanHandoff(customerKey);
    await sendSafeWhatsApp(
      customerKey,
      `✅ Support closed for *${order.id}*.\nBot is active again — type *${order.id}* to track, or *menu*.`
    );
    void notifyAdminEvent("SUPPORT_CLOSED_BY_USER", {
      orderId: order.id,
      details: `${role} ended support (${trimmed}). Bot resumed.`,
    });
    return true;
  }

  appendSupportThread(order.id, {
    direction: "inbound",
    role,
    phone: phone || null,
    customerKey,
    text: trimmed.slice(0, 1000),
  });

  void notifyAdminEvent("SUPPORT_RELAY", {
    orderId: order.id,
    details:
      `📨 *${order.id}* · ${role}${phone ? ` (+${normalizePhone(phone)})` : ""}\n` +
      `${trimmed.slice(0, 800)}\n\n` +
      `Reply: *#${order.id} <message>*\nEnd: *#done ${order.id}* · User can also reply *DONE*`,
  });

  // Forward to the other party (buyer↔seller), not only admin.
  if (role === "BUYER" || role === "SELLER") {
    const preview = trimmed.length > 280 ? `${trimmed.slice(0, 277)}…` : trimmed;
    void notifyCounterpart(
      order,
      role,
      `💬 *${order.id}* · ${role}:\n${preview}\n\nReply in this chat (admin is copied). Or *DONE* to close.`
    );
  }

  // Silent to sender — transparent relay.
  return true;
}

/* -------------------------------------------------------------------------- */
/* Central router                                                             */
/* -------------------------------------------------------------------------- */

/**
 * DISPATCH / YES / HELP / LINKSELLER. Returns true if consumed.
 */
export async function handleOrderBusMessage(customerKey, text, { phone = "" } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;

  // If already in takeover, never run bot commands — relay instead.
  if (findTakeOverOrder(customerKey, phone)) {
    return tryRelayAdminTakeOver(customerKey, text, { phone });
  }

  const linkMatch = trimmed.match(new RegExp(`^LINKSELLER\\s+${ORDER_ID_CAPTURE}\\s+(\\d{4})\\b`, "i"));
  if (linkMatch) {
    await flowLinkSeller(customerKey, phone, orderIdOrEmpty(linkMatch[1]), linkMatch[2]);
    return true;
  }

  const dispatchMatch = trimmed.match(
    new RegExp(
      `^DISPATCH\\s+${ORDER_ID_CAPTURE}(?:\\s+via\\s+rider\\s+([A-Za-z][\\w\\s-]{0,40}))?(?:\\s+((?:\\+?254|0)?\\d{9,12}))?\\b`,
      "i"
    )
  );
  if (dispatchMatch) {
    const id = orderIdOrEmpty(dispatchMatch[1]);
    const riderName = String(dispatchMatch[2] || "").trim();
    const riderPhone = String(dispatchMatch[3] || "").trim();
    if (riderPhone || riderName) {
      const { dispatchOrderWithRider } = await import("./commerce-ops.js");
      const result = await dispatchOrderWithRider({
        orderId: id,
        phone,
        customerKey,
        riderName,
        riderPhone,
      });
      await sendSafeWhatsApp(
        customerKey,
        result.message || (result.ok ? `Dispatched *${id}*.` : result.message || "Dispatch failed.")
      );
      return true;
    }
    await flowSellerDispatch(customerKey, phone, id);
    return true;
  }

  const yesMatch = trimmed.match(new RegExp(`^YES\\s+${ORDER_ID_CAPTURE}\\b`, "i"));
  if (yesMatch) {
    await flowBuyerYes(customerKey, phone, orderIdOrEmpty(yesMatch[1]));
    return true;
  }

  const helpMatch = trimmed.match(new RegExp(`^(HELP|PROBLEM|CANCEL)\\b(?:\\s+${ORDER_ID_CAPTURE})?`, "i"));
  if (helpMatch) {
    const id = helpMatch[2] ? orderIdOrEmpty(helpMatch[2]) : extractOrderIdFromText(trimmed) || "";
    await flowHelp(customerKey, phone, id, trimmed);
    return true;
  }

  return false;
}

/**
 * Bind this WhatsApp chat (@lid) to the order's seller phone using last 4 digits.
 * Then retry DISPATCH automatically.
 */
async function flowLinkSeller(customerKey, phone, orderId, last4) {
  const order = await ensureOrderSupplier(getOrder(orderId));
  if (!order) {
    await sendSafeWhatsApp(customerKey, `Order *${orderId}* not found.`);
    return;
  }
  const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
  const expected = supplierPhoneLast4(supplier);
  if (!supplier?.phone || !expected) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* has no seller phone on file.\nReply HELP ${order.id} so admin can fix it.`
    );
    return;
  }
  if (String(last4) !== expected) {
    console.warn("[communication-hub] LINKSELLER bad last4", {
      orderId: order.id,
      customerKey,
      phone: normalizePhone(phone) || null,
    });
    await sendSafeWhatsApp(
      customerKey,
      `That code doesn't match the seller number for *${order.id}*.\n` +
        `Use the *last 4 digits* of your Sokoni seller WhatsApp / M-Pesa, then:\n` +
        `LINKSELLER ${order.id} ####`
    );
    return;
  }

  registerSellerChatId(customerKey, supplier.phone);
  rememberSellerNotifyTarget(supplier.phone, customerKey);
  console.log("[communication-hub] LINKSELLER ok", { orderId: order.id, customerKey, phone: supplier.phone });

  await sendSafeWhatsApp(
    customerKey,
    `✅ Seller chat linked for *${order.id}*.\nDispatching now…`
  );
  await flowSellerDispatch(customerKey, supplier.phone, order.id);
}

async function flowSellerDispatch(customerKey, phone, orderId) {
  let order = getOrder(orderId);
  if (!order) {
    await sendSafeWhatsApp(customerKey, `Order *${orderId}* not found. Check the SK from your sale alert.`);
    return;
  }
  if (isAdminTakeOver(order) || order.disputeHold) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is with Sokoni support right now. Reply *DONE* when finished, or wait for admin *#done ${order.id}*.`
    );
    return;
  }

  const auth = await authorizeSellerForOrder(order, phone, customerKey);
  order = auth.order || order;
  if (!auth.ok) {
    console.warn("[communication-hub] DISPATCH denied", {
      orderId: order.id,
      reason: auth.reason,
      phone: normalizePhone(phone) || null,
      resolvedPhone: auth.resolvedPhone || null,
      customerKey,
      isLid: Boolean(customerKey?.includes("@lid")),
      inboundSellerId: auth.inboundSellerId || null,
      orderSupplierId: auth.orderSupplierId || order.supplierId || null,
      productSupplierId: auth.productSupplierId || null,
    });
    if (auth.reason === "not_registered_seller") {
      const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
      if (auth.needsLink && supplier?.phone) {
        await sendSafeWhatsApp(
          customerKey,
          `*${order.id}* — this chat isn't linked to your seller account yet (usually only needed for older sellers).\n\n` +
            `One-time fix — last 4 digits of your seller WhatsApp / M-Pesa:\n` +
            `*LINKSELLER ${order.id} ####*\n\n` +
            `New sellers are linked automatically at sign-up / *vendor menu*.`
        );
        return;
      }
      await sendSafeWhatsApp(
        customerKey,
        `*${order.id}* — this WhatsApp is not a Sokoni seller account yet.\nReply *vendor menu* to sign in, then try:\nDISPATCH ${order.id}`
      );
      return;
    }
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is not linked to your seller shop on Sokoni.\n` +
        `If this is your sale, reply *vendor menu* once, then:\nDISPATCH ${order.id}\n` +
        `Or reply HELP ${order.id} so admin can fix the link.`
    );
    return;
  }

  // Keep @lid ↔ seller phone mapping warm after a successful auth.
  {
    const sup = order.supplierId ? getSupplier(order.supplierId) : null;
    if (customerKey && sup?.phone) registerSellerChatId(customerKey, sup.phone);
  }
  if (!isPaidHeld(order)) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is not paid into escrow yet.\nWait for M-Pesa confirmation, then reply:\nDISPATCH ${order.id}`
    );
    return;
  }

  const ship = getEffectiveShipmentStatus(order);
  if (ship === "delivered" || order.status === "delivered") {
    await sendSafeWhatsApp(customerKey, `*${order.id}* is already delivered.`);
    return;
  }

  if (isDispatched(order) && order.sellerDispatchedAt) {
    await sendSafeWhatsApp(
      customerKey,
      `✅ *${order.id}* already dispatched.\nBuyer should reply:\nYES ${order.id}`
    );
    return;
  }

  const result = advanceShipmentStatus(orderId, "in_transit", {
    actor: "seller_dispatch",
    note: "Seller DISPATCH via communication hub",
    skipBuyerNotify: true,
  });
  if (result.error) {
    await sendSafeWhatsApp(customerKey, `Could not dispatch *${orderId}* (${result.error}).`);
    return;
  }

  updateOrderMeta(orderId, {
    sellerDispatchedAt: Date.now(),
    deliveryMode: order.deliveryMode === "pending" ? "seller_dispatch" : order.deliveryMode,
  });

  const fresh = getOrder(orderId) || order;
  void notifyAdminEvent("SELLER_DISPATCHED", {
    orderId: fresh.id,
    details: `IN_TRANSIT — buyer asked for YES ${fresh.id}`,
    silent: true,
  });

  void dispatchMessages([
    { to: customerKey, message: msgSellerDispatchAck(fresh) },
    fresh.customerKey ? { to: fresh.customerKey, message: msgBuyerDispatched(fresh) } : null,
  ]);
}

async function flowBuyerYes(customerKey, phone, orderId) {
  const order = getOrder(orderId);
  if (!order) {
    await sendSafeWhatsApp(customerKey, `Order *${orderId}* not found. Type *track*.`);
    return;
  }

  if (isAdminTakeOver(order) || order.disputeHold) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is paused with Sokoni support — YES confirm is locked until an admin resolves it.`
    );
    return;
  }

  if (sellerOwnsOrder(order, phone, customerKey) && !buyerOwnsOrder(order, customerKey, phone)) {
    await sendSafeWhatsApp(
      customerKey,
      `Sellers can't confirm YES for their own sale (*${order.id}*).\nReply HELP ${order.id} if stuck.`
    );
    return;
  }

  if (!buyerOwnsOrder(order, customerKey, phone)) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is not linked to this WhatsApp. Use the number you paid with.`
    );
    return;
  }

  if (!isPaidHeld(order)) {
    await sendSafeWhatsApp(customerKey, `*${order.id}* is not paid yet.`);
    return;
  }

  if (!isDispatched(order)) {
    await sendSafeWhatsApp(
      customerKey,
      `⚠️ Order *${order.id}* has not been marked as dispatched by the seller yet.\n` +
        `If you already have the item, reply: HELP ${order.id}`
    );
    return;
  }

  try {
    const { orderHasOpenDispute, orderHasDisputeHold } = await import("./disputes.js");
    if (orderHasDisputeHold(order) || (await orderHasOpenDispute(order.id))) {
      await sendSafeWhatsApp(
        customerKey,
        `*${order.id}* has an open dispute — YES confirm is paused.`
      );
      return;
    }
  } catch (err) {
    console.warn("[communication-hub] dispute check skipped:", err.message);
  }

  if (order.status === "delivered" || getEffectiveShipmentStatus(order) === "delivered") {
    await sendSafeWhatsApp(customerKey, msgBuyerConfirmAck(order));
    return;
  }

  const result = advanceShipmentStatus(orderId, "delivered", {
    actor: "buyer_yes",
    note: "Buyer YES via communication hub",
    skipBuyerNotify: true,
  });
  if (result.error) {
    await sendSafeWhatsApp(customerKey, `Could not confirm *${orderId}*. Reply HELP ${orderId}`);
    return;
  }

  updateOrderMeta(orderId, {
    buyerConfirmedAt: Date.now(),
    buyerConfirmedVia: "whatsapp_yes",
  });

  const fresh = getOrder(orderId) || order;
  void notifyAdminEvent("BUYER_CONFIRMED", {
    orderId: fresh.id,
    details: `COMPLETED_BY_BUYER — escrow release path started`,
    silent: true,
  });

  void import("../db/repositories/social.js")
    .then(async ({ ensureOrderSellerUserId, creditSellerSaleReview }) => {
      await ensureOrderSellerUserId(fresh);
      return creditSellerSaleReview(getOrder(fresh.id) || fresh);
    })
    .catch((err) => console.warn("[communication-hub] sale rating credit:", err.message));

  const supplier = fresh.supplierId ? getSupplier(fresh.supplierId) : null;
  const sellerJobs = supplier?.phone
    ? sellerNotifyTargets(supplier.phone).map((to) => ({
        to,
        message: msgSellerBuyerConfirmed(fresh),
      }))
    : [];
  void dispatchMessages([{ to: customerKey, message: msgBuyerConfirmAck(fresh) }, ...sellerJobs]);

  // Automated review collector (24h path also calls this after auto-release).
  try {
    const { sendReviewPrompt } = await import("./reviews.js");
    await sendReviewPrompt(customerKey, fresh);
  } catch (err) {
    console.warn("[communication-hub] review prompt:", err.message);
  }
}

async function flowHelp(customerKey, phone, orderId, rawText) {
  let order = orderId ? getOrder(orderId) : null;
  if (!order) order = resolveActiveOrder({ customerKey, phone, text: rawText });

  if (!order) {
    await sendSafeWhatsApp(
      customerKey,
      `No active Sokoni order found.\nReply HELP SKN-1002-1 (or older SK-1042) with your order id, or type *track*.`
    );
    return;
  }

  const asBuyer = buyerOwnsOrder(order, customerKey, phone);
  const asSeller = sellerOwnsOrder(order, phone, customerKey);
  if (!asBuyer && !asSeller) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is not linked to this WhatsApp. Reply *HELP ${order.id}* on the order number.`
    );
    return;
  }

  if (isAdminTakeOver(order)) {
    await tryRelayAdminTakeOver(customerKey, rawText, { phone });
    return;
  }

  const role = asSeller ? "SELLER" : "BUYER";
  await startAdminTakeOver(order, { customerKey, phone, rawText, role });
  await sendSafeWhatsApp(customerKey, msgHelpAck(getOrder(order.id) || order));
}

/**
 * AI / agent tool: open a buyer return/refund case (escrow hold + admin alert).
 * Does not send WhatsApp itself — the agent replies with evidence instructions.
 */
export async function openBuyerReturnCase({
  orderId,
  customerKey = "",
  phone = "",
  reason = "",
} = {}) {
  const order = orderId ? getOrder(orderId) : null;
  if (!order) {
    return {
      ok: false,
      error: "order_not_found",
      message: "Order not found. Check your SKN-#### (or older SK-####) number.",
    };
  }
  if (!buyerOwnsOrder(order, customerKey, phone)) {
    return {
      ok: false,
      error: "buyer_mismatch",
      message: `*${order.id}* is not linked to this WhatsApp. Use the number you ordered with.`,
    };
  }
  if (isAdminTakeOver(order)) {
    return {
      ok: true,
      alreadyOpen: true,
      orderId: order.id,
      payoutHeld: true,
      askForEvidence: true,
      message:
        `Support is already open on *${order.id}* (escrow held). Reply here with clear photos of the issue so admin can finalize.`,
    };
  }
  const rawText =
    String(reason || "").trim().slice(0, 400) ||
    `AI buyer return / refund request for ${order.id}`;
  await startAdminTakeOver(order, {
    customerKey: customerKey || order.customerKey,
    phone,
    rawText,
    role: "BUYER",
  });
  return {
    ok: true,
    orderId: order.id,
    payoutHeld: true,
    askForEvidence: true,
    ticketHint: `HELP ${order.id}`,
    message:
      `I'm sorry — payout for *${order.id}* is temporarily held.\n` +
      `Please reply with clear photos of the damage / issue so support can finalize within 24 hours.\n` +
      msgHelpAck(getOrder(order.id) || order),
  };
}

/* -------------------------------------------------------------------------- */
/* Reminders + 24h auto-release                                               */
/* -------------------------------------------------------------------------- */

async function autoReleaseOrder(order) {
  const result = advanceShipmentStatus(order.id, "delivered", {
    actor: "auto_release_24h",
    note: "Auto-released 24h after DISPATCH with no YES and no dispute",
    skipBuyerNotify: true,
  });
  if (result.error) return false;

  updateOrderMeta(order.id, {
    buyerConfirmedAt: Date.now(),
    buyerConfirmedVia: "auto_release_24h",
    autoReleasedAt: Date.now(),
    confirmReminded24hAt: Date.now(),
  });

  const fresh = getOrder(order.id) || order;
  void import("../db/repositories/social.js")
    .then(async ({ ensureOrderSellerUserId, creditSellerSaleReview }) => {
      await ensureOrderSellerUserId(fresh);
      return creditSellerSaleReview(getOrder(fresh.id) || fresh);
    })
    .catch((err) => console.warn("[communication-hub] sale rating credit:", err.message));
  const supplier = fresh.supplierId ? getSupplier(fresh.supplierId) : null;
  const sellerJobs = supplier?.phone
    ? sellerNotifyTargets(supplier.phone).map((to) => ({
        to,
        message: msgAutoReleasedSeller(fresh),
      }))
    : [];
  void dispatchMessages([
    fresh.customerKey ? { to: fresh.customerKey, message: msgAutoReleasedBuyer(fresh) } : null,
    ...sellerJobs,
  ]);
  if (fresh.customerKey) {
    try {
      const { sendReviewPrompt } = await import("./reviews.js");
      await sendReviewPrompt(fresh.customerKey, fresh);
    } catch (err) {
      console.warn("[communication-hub] auto-release review prompt:", err.message);
    }
  }
  void notifyAdminEvent("AUTO_RELEASED", {
    orderId: fresh.id,
    details: `Auto-completed 24h after dispatch (no YES, no dispute). Payout scheduled.`,
  });
  return true;
}

/**
 * Hourly: seller DISPATCH reminders; buyer YES 12h remind; 24h auto-release.
 */
export async function processOrderCommunicationReminders() {
  const now = Date.now();
  let n = 0;

  for (const order of listAllOrders()) {
    if (!isPaidHeld(order)) continue;
    if (order.status === "delivered" || order.shipmentStatus === "delivered") continue;
    if (order.disputeHold || order.escrowStatus === "refunded" || isAdminTakeOver(order)) continue;

    const paidAt = Number(order.paidAt || order.customerPaidConfirmedAt || order.createdAt || 0);
    const dispatchedAt = Number(order.sellerDispatchedAt || order.inTransitAt || 0);

    if (!isDispatched(order) && paidAt) {
      const age = now - paidAt;
      const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
      if (supplier?.phone) {
        const targets = sellerNotifyTargets(supplier.phone);
        const remindBody12 =
          `⏰ *Reminder — ${order.id}*\nBuyer paid ~12h ago. When you send the item, reply:\n*DISPATCH ${order.id}*`;
        const remindBody6 =
          `⏰ *Reminder — ${order.id}*\nBuyer paid ~6h ago. When you send the item, reply:\n*DISPATCH ${order.id}*`;
        if (age >= DISPATCH_REMIND_2 && !order.dispatchReminded12hAt) {
          updateOrderMeta(order.id, {
            dispatchReminded12hAt: now,
            sellerNotifyChatIds: targets,
          });
          for (const to of targets) void sendSafeWhatsApp(to, remindBody12);
          n += 1;
        } else if (age >= DISPATCH_REMIND_1 && !order.dispatchReminded6hAt) {
          updateOrderMeta(order.id, {
            dispatchReminded6hAt: now,
            sellerNotifyChatIds: targets,
          });
          for (const to of targets) void sendSafeWhatsApp(to, remindBody6);
          n += 1;
        }
      }
    }

    if (isDispatched(order) && dispatchedAt) {
      const age = now - dispatchedAt;

      if (age >= CONFIRM_REMIND_12H && age < CONFIRM_AUTO_RELEASE_24H && !order.confirmReminded12hAt) {
        updateOrderMeta(order.id, { confirmReminded12hAt: now });
        if (order.customerKey) {
          void sendSafeWhatsApp(
            order.customerKey,
            `⏰ *Reminder — ${order.id}*\n` +
              `Your item was marked dispatched. If you have it, reply:\n*YES ${order.id}*\n\n` +
              `Problem? Reply: HELP ${order.id}`
          );
        }
        n += 1;
      }

      if (age >= CONFIRM_AUTO_RELEASE_24H && !order.autoReleasedAt) {
        let openDispute = false;
        try {
          const { orderHasOpenDispute } = await import("./disputes.js");
          openDispute = await orderHasOpenDispute(order.id);
        } catch {
          openDispute = false;
        }
        if (openDispute || order.disputeHold) {
          if (!order.confirmReminded24hAt) {
            updateOrderMeta(order.id, {
              confirmReminded24hAt: now,
              adminFlagged: true,
              adminFlagReason: "confirm_overdue_with_dispute",
            });
            void notifyAdminEvent("CONFIRM_OVERDUE", {
              orderId: order.id,
              details: `24h after dispatch but dispute/hold is open — no auto-release.`,
            });
            n += 1;
          }
          continue;
        }

        const ok = await autoReleaseOrder(order);
        if (ok) n += 1;
      }
    }
  }

  if (n > 0) console.log(`[communication-hub] reminders/auto-release actions: ${n}`);
  return n;
}

/** List orders needing admin support (dashboard). */
export function listSupportOrders({ limit = 40 } = {}) {
  return listAllOrders()
    .filter((o) => isAdminTakeOver(o) || o.adminFlagged || o.disputeHold)
    .sort((a, b) => (b.supportUpdatedAt || b.adminFlaggedAt || b.updatedAt || 0) - (a.supportUpdatedAt || a.adminFlaggedAt || a.updatedAt || 0))
    .slice(0, limit)
    .map((o) => ({
      orderId: o.id,
      productName: o.productName || null,
      lifecycle: lifecycleLabel(o),
      adminTakeOver: isAdminTakeOver(o),
      disputeHold: Boolean(o.disputeHold),
      dropOff: dropOffLine(o),
      buyerPhone: o.phone || null,
      customerKey: o.customerKey || null,
      supplierId: o.supplierId || null,
      threadCount: Array.isArray(o.supportThread) ? o.supportThread.length : 0,
      updatedAt: o.supportUpdatedAt || o.updatedAt || null,
    }));
}

export function getSupportThread(orderId) {
  const order = getOrder(normalizeOrderId(orderId) || orderId);
  if (!order) return { error: "not_found" };
  return {
    orderId: order.id,
    lifecycle: lifecycleLabel(order),
    adminTakeOver: isAdminTakeOver(order),
    disputeHold: Boolean(order.disputeHold),
    dropOff: dropOffLine(order),
    productName: order.productName || null,
    buyerPhone: order.phone || null,
    customerKey: order.customerKey || null,
    messages: Array.isArray(order.supportThread) ? order.supportThread : [],
  };
}
