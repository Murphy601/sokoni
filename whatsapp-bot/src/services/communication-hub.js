/**
 * Order-state communication hub (WAHA).
 *
 * Lifecycle: PAY → DISPATCH SK-#### → YES SK-#### → escrow release path.
 * HELP → ADMIN_TAKE_OVER (bot silent relay to admin).
 *
 * Stack: JSON orders + WAHA (not Twilio / Mongo / Socket.io).
 */
import { config } from "../config.js";
import { sendText, toChatId } from "./whatsapp.js";
import {
  getOrder,
  getOrdersForCustomer,
  listAllOrders,
  updateOrderMeta,
} from "./orders.js";
import { findSupplierByPhone, getSupplier } from "./suppliers.js";
import { advanceShipmentStatus, getEffectiveShipmentStatus } from "./shipments.js";
import { formatLandmarkLine } from "../lib/landmark-hubs.js";
import { setHumanHandoff, clearHumanHandoff } from "./session.js";

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

function normalizeOrderId(raw) {
  const t = String(raw || "").trim().toUpperCase();
  if (!t) return "";
  // Accept "SK-1019", "SK1019", or bare digits from regex capture groups ("1019").
  const m = t.match(/^(?:SK-?)?(\d{3,})$/i) || t.match(/SK-?(\d{3,})/i);
  return m ? `SK-${m[1]}` : "";
}

function extractOrderIdFromText(text) {
  const m = String(text || "").match(/\bSK-?(\d{3,})\b/i);
  return m ? `SK-${m[1]}` : "";
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

export function sellerOwnsOrder(order, phone) {
  if (!order?.supplierId) return false;
  const supplier = findSupplierByPhone(phone);
  return Boolean(supplier && supplier.id === order.supplierId);
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
  if (sellerOwnsOrder(order, phone)) return "SELLER";
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
    "ADMIN_TAKE_OVER",
    "SUPPORT_RELAY",
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
        ? `Reply to user: *#${orderId} <message>*\nEnd takeover: *#resolve ${orderId}*`
        : `*#help* for admin commands`)
  );
}

/* -------------------------------------------------------------------------- */
/* Templates (expected lifecycle wording, SK-####)                            */
/* -------------------------------------------------------------------------- */

export function msgSellerPaid(order) {
  const payout = order.sellerPayoutKes ?? order.sellerNetKes;
  return (
    `🎉 *New Paid Order on Sokoni!*\n` +
    `Order: *${order.id}*\n` +
    `Item: *${order.productName || "Order"}*\n` +
    `Location: *${dropOffLine(order)}*\n` +
    (payout != null ? `Your payout after delivery: *KES ${Number(payout).toLocaleString()}*\n` : "") +
    `\nPlease pack the item. Once handed to the buyer/courier, reply:\n` +
    `*DISPATCH ${order.id}*\n\n` +
    `Problem? Reply: HELP ${order.id}`
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
    `An admin has joined this chat. Type your message directly below — the bot will stay quiet.`
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
        (buyerOwnsOrder(o, customerKey, phone) || sellerOwnsOrder(o, phone))
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
      `End: #resolve ${order.id}`,
  });
}

/**
 * End ADMIN_TAKE_OVER — bot resumes; escrow unfreeze only if no open DB dispute.
 */
export async function resolveAdminTakeOver(orderId, { note = "" } = {}) {
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

  if (order.customerKey) clearHumanHandoff(order.customerKey);
  const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
  if (supplier?.phone) clearHumanHandoff(toChatId(supplier.phone));

  appendSupportThread(order.id, {
    direction: "system",
    role: "ADMIN",
    text: note ? `Takeover ended: ${note}` : "Takeover ended — bot resumed.",
  });

  const fresh = getOrder(order.id);
  void dispatchMessages([
    fresh.customerKey
      ? {
          to: fresh.customerKey,
          message: `✅ Support closed for *${fresh.id}*. Bot is active again. Type *${fresh.id}* to track.`,
        }
      : null,
    supplier?.phone
      ? {
          to: toChatId(supplier.phone),
          message: `✅ Support closed for *${fresh.id}*. Bot is active again.`,
        }
      : null,
  ]);

  return { ok: true, order: fresh };
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
 * If sender is on an ADMIN_TAKE_OVER order, forward to admin and stay silent.
 * @returns {Promise<boolean>}
 */
export async function tryRelayAdminTakeOver(customerKey, text, { phone = "" } = {}) {
  const order = findTakeOverOrder(customerKey, phone);
  if (!order) return false;

  const trimmed = String(text || "").trim();
  if (!trimmed) return true;

  // Still allow explicit HELP to re-ping, but stay in takeover (no bot commands).
  const role = roleForSender(order, customerKey, phone);
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
      `Reply: *#${order.id} <message>*\nEnd: *#resolve ${order.id}*`,
  });

  // Silent — no WhatsApp reply to user (transparent relay).
  return true;
}

/* -------------------------------------------------------------------------- */
/* Central router                                                             */
/* -------------------------------------------------------------------------- */

/**
 * DISPATCH / YES / HELP. Returns true if consumed.
 */
export async function handleOrderBusMessage(customerKey, text, { phone = "" } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;

  // If already in takeover, never run bot commands — relay instead.
  if (findTakeOverOrder(customerKey, phone)) {
    return tryRelayAdminTakeOver(customerKey, text, { phone });
  }

  const dispatchMatch = trimmed.match(/^DISPATCH\s+SK-?(\d{3,})\b/i);
  if (dispatchMatch) {
    await flowSellerDispatch(customerKey, phone, normalizeOrderId(dispatchMatch[1]));
    return true;
  }

  const yesMatch = trimmed.match(/^YES\s+SK-?(\d{3,})\b/i);
  if (yesMatch) {
    await flowBuyerYes(customerKey, phone, normalizeOrderId(yesMatch[1]));
    return true;
  }

  const helpMatch = trimmed.match(/^(HELP|PROBLEM|CANCEL)\b(?:\s+SK-?(\d{3,}))?/i);
  if (helpMatch) {
    const id = helpMatch[2] ? normalizeOrderId(helpMatch[2]) : extractOrderIdFromText(trimmed);
    await flowHelp(customerKey, phone, id, trimmed);
    return true;
  }

  return false;
}

async function flowSellerDispatch(customerKey, phone, orderId) {
  const order = getOrder(orderId);
  if (!order) {
    await sendSafeWhatsApp(customerKey, `Order *${orderId}* not found. Check the SK from your sale alert.`);
    return;
  }
  if (isAdminTakeOver(order) || order.disputeHold) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is with Sokoni support right now. An admin will update you.`
    );
    return;
  }
  if (!sellerOwnsOrder(order, phone)) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is not on your seller account.\nUse the SK from your sale message, or reply *vendor menu*.`
    );
    return;
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

  if (sellerOwnsOrder(order, phone) && !buyerOwnsOrder(order, customerKey, phone)) {
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

  const supplier = fresh.supplierId ? getSupplier(fresh.supplierId) : null;
  void dispatchMessages([
    { to: customerKey, message: msgBuyerConfirmAck(fresh) },
    supplier?.phone ? { to: toChatId(supplier.phone), message: msgSellerBuyerConfirmed(fresh) } : null,
  ]);
}

async function flowHelp(customerKey, phone, orderId, rawText) {
  let order = orderId ? getOrder(orderId) : null;
  if (!order) order = resolveActiveOrder({ customerKey, phone, text: rawText });

  if (!order) {
    await sendSafeWhatsApp(
      customerKey,
      `No active Sokoni order found.\nReply HELP SK-1042 with your order id, or type *track*.`
    );
    return;
  }

  const asBuyer = buyerOwnsOrder(order, customerKey, phone);
  const asSeller = sellerOwnsOrder(order, phone);
  if (!asBuyer && !asSeller) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is not linked to this WhatsApp. Reply HELP SK-#### on the order number.`
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
  const supplier = fresh.supplierId ? getSupplier(fresh.supplierId) : null;
  void dispatchMessages([
    fresh.customerKey ? { to: fresh.customerKey, message: msgAutoReleasedBuyer(fresh) } : null,
    supplier?.phone ? { to: toChatId(supplier.phone), message: msgAutoReleasedSeller(fresh) } : null,
  ]);
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
        if (age >= DISPATCH_REMIND_2 && !order.dispatchReminded12hAt) {
          updateOrderMeta(order.id, { dispatchReminded12hAt: now });
          void sendSafeWhatsApp(
            toChatId(supplier.phone),
            `⏰ *Reminder — ${order.id}*\nBuyer paid ~12h ago. When you send the item, reply:\n*DISPATCH ${order.id}*`
          );
          n += 1;
        } else if (age >= DISPATCH_REMIND_1 && !order.dispatchReminded6hAt) {
          updateOrderMeta(order.id, { dispatchReminded6hAt: now });
          void sendSafeWhatsApp(
            toChatId(supplier.phone),
            `⏰ *Reminder — ${order.id}*\nBuyer paid ~6h ago. When you send the item, reply:\n*DISPATCH ${order.id}*`
          );
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
