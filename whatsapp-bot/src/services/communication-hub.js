/**
 * Order-state communication hub (WAHA).
 *
 * Incoming DISPATCH / YES / HELP hit order state first, update the order,
 * alert admin, then notify the other party — never person-to-person chat.
 *
 * Stack: existing JSON orders + WAHA sendText (not Twilio/Mongo/BullMQ).
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
import { setHumanHandoff, getCustomerMeta } from "./session.js";

const HOUR_MS = 60 * 60 * 1000;
const DISPATCH_REMIND_1 = 6 * HOUR_MS;
const DISPATCH_REMIND_2 = 12 * HOUR_MS;
const CONFIRM_REMIND = 24 * HOUR_MS;

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
  const m = t.match(/SK-?(\d{3,})/i);
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

export function lifecycleLabel(order) {
  if (!order) return "UNKNOWN";
  if (order.status === "delivered" || order.shipmentStatus === "delivered") return "DELIVERED";
  if (order.disputeHold || order.adminFlagged) return "NEEDS_ADMIN";
  if (isDispatched(order)) return "DISPATCHED";
  if (isPaidHeld(order)) return "PAID_ESCROW";
  if (order.status === "awaiting_payment") return "AWAITING_PAYMENT";
  return String(order.status || "OPEN").toUpperCase();
}

/** Drop-off line for templates — landmark hub or free-text location. */
export function dropOffLine(order) {
  const landmark = formatLandmarkLine(order);
  if (landmark) return landmark;
  return String(order?.location || "").trim() || "your drop-off point";
}

/* -------------------------------------------------------------------------- */
/* Safe send + admin events (non-blocking)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Never throw — WAHA/offline seller must not block order state updates.
 * @returns {Promise<{ success: boolean, error?: string, dryRun?: boolean }>}
 */
export async function sendSafeWhatsApp(to, message) {
  if (!to || !message) return { success: false, error: "missing_to_or_message" };
  try {
    const result = await sendText(to, message);
    return { success: true, dryRun: Boolean(result?.dryRun) };
  } catch (err) {
    const error = err?.message || String(err);
    console.error(`[communication-hub] WhatsApp failed → ${to}:`, error);
    void notifyAdminEvent("WA_SEND_FAILED", {
      orderId: null,
      details: `Failed to notify ${to}: ${error}`,
      silent: true,
    });
    return { success: false, error };
  }
}

/** Fire-and-forget multi-send (does not await callers' state writes). */
export function dispatchMessages(jobs = []) {
  return Promise.allSettled(
    jobs.filter((j) => j?.to && j?.message).map((j) => sendSafeWhatsApp(j.to, j.message))
  );
}

/**
 * Admin shadow: WhatsApp to ops + optional ADMIN_NOTIFY_URL webhook.
 */
export async function notifyAdminEvent(eventType, { orderId = null, details = "", silent = false } = {}) {
  const line = `[ADMIN EVENT] [${eventType}]${orderId ? ` ${orderId}` : ""} | ${details}`;
  console.log(line);

  if (config.adminNotifyUrl) {
    try {
      await fetch(config.adminNotifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "order_event",
          eventType,
          orderId,
          details,
          at: Date.now(),
        }),
      });
    } catch (err) {
      console.warn("[communication-hub] admin webhook failed:", err.message);
    }
  }

  if (silent || !config.admin.primary) return;

  // High-signal events only — avoid spam on every shipment tick.
  const ping =
    eventType === "DISPUTE_OR_HELP" ||
    eventType === "PAYOUT_FAILED" ||
    eventType === "CONFIRM_OVERDUE" ||
    eventType === "SELLER_DISPATCHED" ||
    eventType === "BUYER_CONFIRMED";

  if (!ping) return;

  await sendSafeWhatsApp(
    config.admin.primary,
    `🛎️ *${eventType}*\n` +
      (orderId ? `Order: *${orderId}*\n` : "") +
      `${details}\n\n` +
      (orderId
        ? `Take over: *#${orderId} <message>*\nStatus: *#status ${orderId} delivered*`
        : `*#help* for admin commands`)
  );
}

/* -------------------------------------------------------------------------- */
/* Clear message templates (always include SK-####)                           */
/* -------------------------------------------------------------------------- */

export function msgSellerPaid(order) {
  const payout = order.sellerPayoutKes ?? order.sellerNetKes;
  return (
    `🛒 *NEW SALE — ${order.id}*\n\n` +
    `Item: *${order.productName || "Order"}*\n` +
    `Buyer paid into Sokoni escrow.\n` +
    `Drop-off: *${dropOffLine(order)}*\n` +
    (payout != null ? `Your payout after delivery: *KES ${Number(payout).toLocaleString()}*\n` : "") +
    `\n*Next step — when you send the item, reply exactly:*\n` +
    `DISPATCH ${order.id}\n\n` +
    `Buyer will confirm with:\nYES ${order.id}\n\n` +
    `Need help? Reply: HELP ${order.id}`
  );
}

export function msgBuyerPaid(order) {
  return (
    `✅ *PAYMENT HELD — ${order.id}*\n\n` +
    `We received your M-Pesa for *${order.productName || "your order"}*.\n` +
    `Money stays in Sokoni escrow until you confirm delivery.\n\n` +
    `Drop-off: *${dropOffLine(order)}*\n\n` +
    `*What happens next*\n` +
    `1. Seller sends the item\n` +
    `2. You get a dispatch update for *${order.id}*\n` +
    `3. When you receive it, reply:\nYES ${order.id}\n\n` +
    `Problem? Reply: HELP ${order.id}\n` +
    `Track: type *${order.id}* or *track*`
  );
}

export function msgBuyerDispatched(order) {
  return (
    `📦 *DISPATCHED — ${order.id}*\n\n` +
    `Your *${order.productName || "item"}* is on the way to:\n` +
    `*${dropOffLine(order)}*\n\n` +
    `When you receive it and it looks right, reply exactly:\n` +
    `YES ${order.id}\n\n` +
    `That confirms delivery so we can pay the seller.\n` +
    `⚠️ Do *not* reply YES if something is wrong — reply:\nHELP ${order.id}`
  );
}

export function msgSellerDispatchAck(order) {
  return (
    `✅ *DISPATCHED — ${order.id}*\n\n` +
    `Buyer has been told to reply:\nYES ${order.id}\n` +
    `after they receive *${order.productName || "the item"}*.\n\n` +
    `Escrow stays held until they confirm (or Sokoni/admin marks delivered).\n` +
    `Stuck? Reply: HELP ${order.id}`
  );
}

export function msgBuyerConfirmAck(order) {
  return (
    `🎉 *DELIVERED — ${order.id}*\n\n` +
    `Thanks for confirming. Enjoy *${order.productName || "your order"}*.\n` +
    `Seller payout follows the normal escrow hold (usually 2–3 business days).\n\n` +
    `Issue later? Reply: HELP ${order.id}`
  );
}

export function msgSellerBuyerConfirmed(order) {
  return (
    `✅ *BUYER CONFIRMED — ${order.id}*\n\n` +
    `They replied YES for *${order.productName || "the order"}*.\n` +
    `Delivery recorded. Payout follows the escrow hold (usually 2–3 business days).\n\n` +
    `Wallet: reply *balance*`
  );
}

export function msgHelpAck(order) {
  return (
    `🆘 *HELP LOGGED — ${order.id}*\n\n` +
    `A Sokoni admin has been alerted for this order.\n` +
    `Status: *${lifecycleLabel(order)}*\n\n` +
    `We'll message you here. You can also type *${order.id}* to track.`
  );
}

export function msgStatusHint(order) {
  return (
    `Sokoni · active order *${order.id}* (${lifecycleLabel(order)}).\n\n` +
    (isPaidHeld(order) && !isDispatched(order)
      ? `Seller next step: DISPATCH ${order.id}\n`
      : "") +
    (isDispatched(order) && order.status !== "delivered"
      ? `Buyer next step: YES ${order.id}\n`
      : "") +
    `Help: HELP ${order.id}`
  );
}

/* -------------------------------------------------------------------------- */
/* Resolve order context                                                      */
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
  // Prefer unpaid → paid open → any recent
  const open = candidates.find(
    (o) =>
      o.status !== "delivered" &&
      o.shipmentStatus !== "delivered" &&
      (isPaidHeld(o) || o.status === "awaiting_payment")
  );
  return open || candidates[0] || null;
}

/* -------------------------------------------------------------------------- */
/* Central router                                                             */
/* -------------------------------------------------------------------------- */

/**
 * State-driven handler for DISPATCH / YES / HELP (order-scoped).
 * @returns {Promise<boolean>} true if consumed
 */
export async function handleOrderBusMessage(customerKey, text, { phone = "" } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;

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
    await sendSafeWhatsApp(customerKey, `Order *${orderId}* not found. Check the SK number from your sale alert.`);
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
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is already delivered. Payout follows the escrow hold.`
    );
    return;
  }

  if (isDispatched(order) && order.sellerDispatchedAt) {
    await sendSafeWhatsApp(
      customerKey,
      `✅ *${order.id}* already dispatched.\nBuyer should reply:\nYES ${order.id}`
    );
    return;
  }

  // State update first — notifications must not block.
  const result = advanceShipmentStatus(orderId, "in_transit", {
    actor: "seller_dispatch",
    note: "Seller DISPATCH via communication hub",
    skipBuyerNotify: true, // hub sends clearer buyer copy below
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
    details: `Seller marked dispatched → buyer asked for YES ${fresh.id}`,
  });

  void dispatchMessages([
    { to: customerKey, message: msgSellerDispatchAck(fresh) },
    fresh.customerKey ? { to: fresh.customerKey, message: msgBuyerDispatched(fresh) } : null,
  ]);
}

async function flowBuyerYes(customerKey, phone, orderId) {
  const order = getOrder(orderId);
  if (!order) {
    await sendSafeWhatsApp(customerKey, `Order *${orderId}* not found. Type *track* for your orders.`);
    return;
  }

  if (sellerOwnsOrder(order, phone) && !buyerOwnsOrder(order, customerKey, phone)) {
    await sendSafeWhatsApp(
      customerKey,
      `Sellers can't confirm YES for their own sale (*${order.id}*).\nWait for the buyer, or reply HELP ${order.id}`
    );
    return;
  }

  if (!buyerOwnsOrder(order, customerKey, phone)) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is not linked to this WhatsApp.\nUse the number you paid with, or type *track*.`
    );
    return;
  }

  if (!isPaidHeld(order)) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is not paid yet. Finish checkout, then you can confirm with YES ${order.id}`
    );
    return;
  }

  if (!isDispatched(order)) {
    await sendSafeWhatsApp(
      customerKey,
      `⚠️ *${order.id}* has not been dispatched yet.\n` +
        `Wait for the seller to send it (they'll reply DISPATCH ${order.id}).\n` +
        `If you already have the item, reply: HELP ${order.id}`
    );
    return;
  }

  try {
    const { orderHasOpenDispute, orderHasDisputeHold } = await import("./disputes.js");
    if (orderHasDisputeHold(order) || (await orderHasOpenDispute(order.id))) {
      await sendSafeWhatsApp(
        customerKey,
        `*${order.id}* has an open dispute — YES confirm is paused until Sokoni resolves it.`
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
    await sendSafeWhatsApp(customerKey, `Could not confirm *${orderId}* (${result.error}). Reply HELP ${orderId}`);
    return;
  }

  updateOrderMeta(orderId, {
    buyerConfirmedAt: Date.now(),
    buyerConfirmedVia: "whatsapp_yes",
  });

  const fresh = getOrder(orderId) || order;
  void notifyAdminEvent("BUYER_CONFIRMED", {
    orderId: fresh.id,
    details: `Buyer confirmed YES — escrow release path started`,
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
      `No active Sokoni order found on this number.\n` +
        `Reply with your order id, e.g. HELP SK-1042\n` +
        `Or type *track*.`
    );
    return;
  }

  // Ownership: buyer or seller on this order (or we still flag for admin).
  const asBuyer = buyerOwnsOrder(order, customerKey, phone);
  const asSeller = sellerOwnsOrder(order, phone);
  if (!asBuyer && !asSeller) {
    await sendSafeWhatsApp(
      customerKey,
      `*${order.id}* is not linked to this WhatsApp. Reply HELP SK-#### using the number on the order.`
    );
    return;
  }

  updateOrderMeta(order.id, {
    adminFlagged: true,
    adminFlaggedAt: Date.now(),
    adminFlagReason: String(rawText || "HELP").slice(0, 200),
  });

  const meta = getCustomerMeta(customerKey) || {};
  setHumanHandoff(customerKey, {
    startedAt: Date.now(),
    orderId: order.id,
    adminDirect: false,
    ackSent: true,
  });

  void notifyAdminEvent("DISPUTE_OR_HELP", {
    orderId: order.id,
    details:
      `${asSeller ? "Seller" : "Buyer"} asked for help.\n` +
      `Phone: ${phone || "—"}\n` +
      `Said: "${String(rawText || "").slice(0, 160)}"\n` +
      `State: ${lifecycleLabel(order)}\n` +
      `Take over: #${order.id} <message>`,
  });

  await sendSafeWhatsApp(customerKey, msgHelpAck(getOrder(order.id) || order));
}

/* -------------------------------------------------------------------------- */
/* Reminders (hourly cron)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Remind sellers to DISPATCH; flag overdue buyer YES for admin (no silent auto-release).
 */
export async function processOrderCommunicationReminders() {
  const now = Date.now();
  let n = 0;

  for (const order of listAllOrders()) {
    if (!isPaidHeld(order)) continue;
    if (order.status === "delivered" || order.shipmentStatus === "delivered") continue;
    if (order.disputeHold || order.escrowStatus === "refunded") continue;

    const paidAt = Number(order.paidAt || order.customerPaidConfirmedAt || order.createdAt || 0);
    const dispatchedAt = Number(order.sellerDispatchedAt || order.inTransitAt || 0);

    // Seller forgot DISPATCH
    if (!isDispatched(order) && paidAt) {
      const age = now - paidAt;
      const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
      if (supplier?.phone) {
        if (age >= DISPATCH_REMIND_2 && !order.dispatchReminded12hAt) {
          updateOrderMeta(order.id, { dispatchReminded12hAt: now });
          void sendSafeWhatsApp(
            toChatId(supplier.phone),
            `⏰ *Reminder — ${order.id}*\n` +
              `Buyer paid ~12h ago. When you send the item, reply:\nDISPATCH ${order.id}`
          );
          n += 1;
        } else if (age >= DISPATCH_REMIND_1 && !order.dispatchReminded6hAt) {
          updateOrderMeta(order.id, { dispatchReminded6hAt: now });
          void sendSafeWhatsApp(
            toChatId(supplier.phone),
            `⏰ *Reminder — ${order.id}*\n` +
              `Buyer paid ~6h ago. When you send the item, reply:\nDISPATCH ${order.id}`
          );
          n += 1;
        }
      }
    }

    // Buyer ignored YES — remind + admin flag (no auto-release)
    if (isDispatched(order) && dispatchedAt) {
      const age = now - dispatchedAt;
      if (age >= CONFIRM_REMIND && !order.confirmReminded24hAt) {
        updateOrderMeta(order.id, {
          confirmReminded24hAt: now,
          adminFlagged: true,
          adminFlagReason: "buyer_confirm_overdue_24h",
        });
        if (order.customerKey) {
          void sendSafeWhatsApp(
            order.customerKey,
            `⏰ *Reminder — ${order.id}*\n` +
              `Your item was marked dispatched. If you have it, reply:\nYES ${order.id}\n\n` +
              `Problem? Reply: HELP ${order.id}`
          );
        }
        void notifyAdminEvent("CONFIRM_OVERDUE", {
          orderId: order.id,
          details: `Buyer has not confirmed YES ~24h after dispatch. Manual check recommended (no auto-release).`,
        });
        n += 1;
      }
    }
  }

  if (n > 0) console.log(`[communication-hub] reminders sent/flagged: ${n}`);
  return n;
}
