/**
 * Feature 4 — WAHA delivery confirm loop (prepaid escrow).
 * Seller: DISPATCH SK-####
 * Buyer:  YES SK-####
 */
import { sendText } from "./whatsapp.js";
import { getOrder, getOrdersForCustomer, updateOrderMeta } from "./orders.js";
import { findSupplierByPhone, getSupplier } from "./suppliers.js";
import { advanceShipmentStatus, getEffectiveShipmentStatus } from "./shipments.js";
import { formatLandmarkLine } from "../lib/landmark-hubs.js";

function normalizeOrderId(rawDigits) {
  const digits = String(rawDigits || "").replace(/\D/g, "");
  return digits ? `SK-${digits}` : "";
}

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

function buyerOwnsOrder(order, customerKey, phone) {
  if (!order) return false;
  if (order.customerKey && order.customerKey === customerKey) return true;
  const want = normalizePhone(phone);
  if (!want) return false;
  if (phonesMatch(order.phone, want) || phonesMatch(order.mpesaPhone, want)) return true;
  const keyDigits = String(order.customerKey || "").replace(/\D/g, "");
  return Boolean(keyDigits && phonesMatch(keyDigits, want));
}

function sellerOwnsOrder(order, phone) {
  if (!order?.supplierId) return false;
  const supplier = findSupplierByPhone(phone);
  if (!supplier) return false;
  return supplier.id === order.supplierId;
}

function isPaidHeld(order) {
  return (
    order?.customerPaymentStatus === "confirmed" ||
    order?.escrowStatus === "held" ||
    order?.escrowStatus === "released"
  );
}

/**
 * @returns {Promise<boolean>} true if the message was handled
 */
export async function tryHandleWaDeliveryConfirm(customerKey, text, { phone = "" } = {}) {
  const trimmed = String(text || "").trim();

  const dispatchMatch = trimmed.match(/^DISPATCH\s+SK-?(\d{3,})\b/i);
  if (dispatchMatch) {
    await handleSellerDispatch(customerKey, phone, normalizeOrderId(dispatchMatch[1]));
    return true;
  }

  const yesMatch = trimmed.match(/^YES\s+SK-?(\d{3,})\b/i);
  if (yesMatch) {
    await handleBuyerYes(customerKey, phone, normalizeOrderId(yesMatch[1]));
    return true;
  }

  return false;
}

async function handleSellerDispatch(customerKey, phone, orderId) {
  const order = getOrder(orderId);
  if (!order) {
    return sendText(customerKey, `Order *${orderId}* not found. Check the SK number and try again.`);
  }

  if (!sellerOwnsOrder(order, phone)) {
    return sendText(
      customerKey,
      `That order isn't on your seller account. Use the SK from your sale alert, or reply *vendor menu*.`
    );
  }

  if (!isPaidHeld(order)) {
    return sendText(
      customerKey,
      `*${order.id}* isn't paid into escrow yet — wait for M-Pesa confirmation before dispatching.`
    );
  }

  const status = getEffectiveShipmentStatus(order);
  if (status === "delivered" || order.status === "delivered") {
    return sendText(
      customerKey,
      `*${order.id}* is already delivered. Escrow release follows the normal hold window.`
    );
  }

  if (["in_transit", "at_pickup_point"].includes(status) && order.sellerDispatchedAt) {
    return sendText(
      customerKey,
      `✅ *${order.id}* is already marked dispatched.\n\n` +
        `Buyer should reply *YES ${order.id}* after they receive the item.`
    );
  }

  const result = advanceShipmentStatus(orderId, "in_transit", {
    actor: "seller_dispatch",
    note: "Seller DISPATCH via WhatsApp",
  });
  if (result.error) {
    return sendText(customerKey, `Could not mark *${orderId}* dispatched (${result.error}).`);
  }

  updateOrderMeta(orderId, {
    sellerDispatchedAt: Date.now(),
    deliveryMode: order.deliveryMode === "pending" ? "seller_dispatch" : order.deliveryMode,
  });

  const landmark = formatLandmarkLine(order);
  const dropHint = landmark ? `\nDrop-off: *${landmark}*` : order.location ? `\nLocation: *${order.location}*` : "";

  await sendText(
    customerKey,
    `🚚 *${order.id}* marked *dispatched*.\n` +
      `Buyer gets an *in transit* update and should reply *YES ${order.id}* when they receive it.` +
      dropHint +
      `\n\nEscrow stays held until the buyer confirms (or admin/hub marks delivered).`
  );
}

async function handleBuyerYes(customerKey, phone, orderId) {
  const order = getOrder(orderId);
  if (!order) {
    return sendText(customerKey, `Order *${orderId}* not found. Type *track* to see your orders.`);
  }

  // Sellers must not self-confirm.
  if (sellerOwnsOrder(order, phone) && !buyerOwnsOrder(order, customerKey, phone)) {
    return sendText(
      customerKey,
      `Sellers can't confirm *YES* for their own sale. Wait for the buyer, or ask support if there's a problem.`
    );
  }

  if (!buyerOwnsOrder(order, customerKey, phone)) {
    // Soft check: also allow if this phone appears on any of their orders with that id via list
    const owned = getOrdersForCustomer(customerKey, phone).some((o) => o.id === order.id);
    if (!owned) {
      return sendText(
        customerKey,
        `That order isn't linked to this WhatsApp. Use the number you paid with, or type *track*.`
      );
    }
  }

  if (!isPaidHeld(order)) {
    return sendText(customerKey, `*${order.id}* isn't paid yet — complete checkout before confirming delivery.`);
  }

  try {
    const { orderHasOpenDispute, orderHasDisputeHold } = await import("./disputes.js");
    if (orderHasDisputeHold(order) || (await orderHasOpenDispute(order.id))) {
      return sendText(
        customerKey,
        `*${order.id}* has an open dispute — delivery confirm is paused until Sokoni resolves it.`
      );
    }
  } catch (err) {
    console.warn("[wa-delivery-confirm] dispute check skipped:", err.message);
  }

  if (order.status === "delivered" || getEffectiveShipmentStatus(order) === "delivered") {
    return sendText(
      customerKey,
      `✅ *${order.id}* was already confirmed delivered. Asante! Type *track* anytime.`
    );
  }

  // advanceShipmentStatus → syncOrderStatus → onOrderDelivered (escrow schedule). Do not call confirmOrderDelivery (double release).
  const result = advanceShipmentStatus(orderId, "delivered", {
    actor: "buyer_yes",
    note: "Buyer confirmed YES SK via WhatsApp",
  });
  if (result.error) {
    return sendText(customerKey, `Could not confirm *${orderId}* (${result.error}). Try again or message support.`);
  }

  updateOrderMeta(orderId, {
    buyerConfirmedAt: Date.now(),
    buyerConfirmedVia: "whatsapp_yes",
  });

  await sendText(
    customerKey,
    `✅ *Thanks!* *${order.id}* marked delivered.\n\n` +
      `Sokoni escrow will release to the seller after the hold window. Enjoy *${order.productName || "your order"}*!`
  );

  const supplier = order.supplierId ? getSupplier(order.supplierId) : null;
  if (supplier?.phone) {
    const { toChatId } = await import("./whatsapp.js");
    await sendText(
      toChatId(supplier.phone),
      `✅ Buyer confirmed *YES ${order.id}*.\n` +
        `Delivery recorded — payout follows the escrow hold (usually 2–3 business days).`
    );
  }
}
