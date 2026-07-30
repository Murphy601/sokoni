/**
 * Automated escrow actions after Daraja confirms M-Pesa payment.
 * No manual admin #payconfirm required when STK callback succeeds.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { sendText, toChatId } from "./whatsapp.js";
import {
  getOrder,
  updateOrderMeta,
  updateOrderStatus,
  findOrderByCheckoutRequestId,
  findProcessingOrderByPhoneAmount,
} from "./orders.js";
import { planFulfillment, applyFulfillmentPlan } from "./fulfillment.js";
import { getSupplier } from "./suppliers.js";
import { invalidateProductCache } from "./catalog.js";
import { scheduleSellerPayoutAfterDelivery, addBusinessDays } from "./settlements.js";
import { advanceShipmentStatus } from "./shipments.js";
import { recordPurchaseFeedEvent } from "./feed-ranking.js";
import { isDbEnabled } from "../db/pool.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import { labelPageUrlForOrder } from "./prepaid-checkout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_PATH = path.join(__dirname, "..", "data", "products.json");
const REPO_PRODUCTS = path.join(__dirname, "..", "..", "..", "website", "data", "products.json");

/** Generate prepaid drop-off QR / label metadata (Depop-style). */
export function generateDropoffLabel(order) {
  const code = order.id;
  const labelUrl = labelPageUrlForOrder(code);
  return {
    dropOffCode: code,
    trackingCode: code,
    labelUrl,
    qrPayload: `SOKONI:${code}`,
    shipmentStatus: "label_ready",
    instructions:
      `Print or show this code at any Sokoni drop-off hub.\n` +
      `Tracking: *${code}*\n` +
      `Label: ${labelUrl}`,
  };
}

async function lockProductForOrder(order) {
  if (!order?.productId) return;
  const paths = [PRODUCTS_PATH, REPO_PRODUCTS].filter((p) => existsSync(p));
  for (const file of paths) {
    try {
      const raw = await readFile(file, "utf-8");
      const products = JSON.parse(raw);
      const idx = products.findIndex((p) => p.id === order.productId);
      if (idx === -1) continue;
      products[idx] = {
        ...products[idx],
        inStock: false,
        isSold: true,
        soldAt: Date.now(),
        soldOrderId: order.id,
      };
      await writeFile(file, JSON.stringify(products, null, 2) + "\n", "utf-8");
    } catch (err) {
      console.warn("[escrow] lock product failed:", file, err.message);
    }
  }
  invalidateProductCache();

  if (isDbEnabled()) {
    try {
      const { markProductSold } = await import("../db/repositories/products.js");
      await markProductSold(order.productId, order.id);
    } catch (err) {
      console.warn("[escrow] DB mark sold failed:", err.message);
    }
  }
}

async function notifyBuyerPaid(order, payment) {
  const amt = payment.amount ?? orderBuyerTotal(order);
  const trackUrl = `${config.publicSiteUrl}/track.html?order=${encodeURIComponent(order.id)}`;
  const sellerHandled =
    order.shippingRecipient === "seller" ||
    order.deliveryMethod === "seller_express" ||
    order.deliveryMethod === "meetup";

  if (sellerHandled) {
    const meet = order.deliveryMethod === "meetup";
    await sendText(
      order.customerKey,
      `✅ *Payment received!*\n\n` +
        `Receipt: *${payment.mpesaReceiptNumber || "—"}*\n` +
        `Amount: *KES ${Number(amt).toLocaleString()}*\n` +
        `Order: *${order.id}*\n\n` +
        `🔒 Funds held in Sokoni escrow until delivery is confirmed.\n\n` +
        (meet
          ? `🤝 Seller will arrange an in-person meetup. Confirm once you have the item.\n\n`
          : `🛵 Seller will arrange delivery (seller express). Confirm once it arrives.\n\n`) +
        `Track anytime: type *track* or *${order.id}*\n` +
        `🌐 Live status: ${trackUrl}`
    );
    return;
  }

  const label = generateDropoffLabel(order);
  await sendText(
    order.customerKey,
    `✅ *Payment received!*\n\n` +
      `Receipt: *${payment.mpesaReceiptNumber || "—"}*\n` +
      `Amount: *KES ${Number(amt).toLocaleString()}*\n` +
      `Order: *${order.id}*\n\n` +
      `🔒 Funds held in Sokoni escrow until delivery is confirmed.\n\n` +
      `📦 Tracking: *${label.trackingCode}*\n` +
      `Seller will drop off using prepaid label *${label.dropOffCode}*.\n\n` +
      `Track anytime: type *track* or *${order.id}*\n` +
      `🌐 Live status: ${trackUrl}`
  );
}

async function notifySellerDropoff(order, label) {
  if (!order.supplierId) return;
  const sup = getSupplier(order.supplierId);
  if (!sup?.phone) return;
  const chat = toChatId(sup.phone);
  const sellerHandled =
    order.shippingRecipient === "seller" ||
    order.deliveryMethod === "seller_express" ||
    order.deliveryMethod === "meetup";
  const payout = order.sellerPayoutKes ?? order.sellerNetKes;

  if (sellerHandled) {
    const meet = order.deliveryMethod === "meetup";
    const shipNote =
      !meet && order.shippingKes
        ? `Delivery fee KES ${Number(order.shippingKes).toLocaleString()} is included in your payout.\n`
        : "";
    await sendText(
      chat,
      `📦 *New prepaid sale — ${order.id}*\n\n` +
        `*${order.productName}* — buyer paid upfront (escrow held).\n\n` +
        (meet
          ? `🤝 Arrange a safe meetup with the buyer, then confirm delivery in Seller Hub.\n`
          : `🛵 Arrange delivery with your courier, then confirm delivery in Seller Hub.\n`) +
        shipNote +
        (payout != null ? `Your payout after delivery: *KES ${Number(payout).toLocaleString()}*\n` : "") +
        `Payout: 2–3 business days after *Delivered* is confirmed.`
    );
    return;
  }

  await sendText(
    chat,
    `📦 *New prepaid sale — ${order.id}*\n\n` +
      `*${order.productName}* — buyer paid upfront (escrow held).\n\n` +
      `1️⃣ Attach prepaid label *${label.dropOffCode}*\n` +
      `2️⃣ Drop package at nearest Sokoni hub\n` +
      `3️⃣ Hub scan updates status to *In Transit*\n\n` +
      `Label / QR: ${label.labelUrl}\n` +
      `Payout: 2–3 business days after courier confirms *Delivered*.`
  );
}

/**
 * Apply full post-payment automation (Daraja callback → PAID).
 */
export async function applyPostPaymentAutomation(order, payment = {}) {
  if (!order?.id) return { error: "missing_order" };
  if (order.customerPaymentStatus === "confirmed") {
    return { order, skipped: true, reason: "already_paid" };
  }

  const sellerHandled =
    order.shippingRecipient === "seller" ||
    order.deliveryMethod === "seller_express" ||
    order.deliveryMethod === "meetup";
  const label = generateDropoffLabel(order);

  updateOrderMeta(order.id, {
    customerPaymentStatus: "confirmed",
    customerPaidConfirmedAt: Date.now(),
    paymentStatus: "paid",
    escrowStatus: "held",
    mpesaReceipt: payment.mpesaReceiptNumber || null,
    mpesaPhone: payment.phoneNumber || order.phone,
    checkoutRequestId: payment.checkoutRequestId || order.checkoutRequestId || null,
    paidAt: Date.now(),
    dropOffCode: sellerHandled ? null : label.dropOffCode,
    labelUrl: sellerHandled ? null : label.labelUrl,
    qrPayload: label.qrPayload,
    autoPayment: true,
  });

  advanceShipmentStatus(order.id, sellerHandled ? "pending" : "label_ready", {
    note: sellerHandled
      ? "Seller-handled delivery — awaiting meetup or express dispatch"
      : "Prepaid label generated after M-Pesa payment",
    actor: "daraja_callback",
  });

  if (order.status === "awaiting_payment") {
    updateOrderStatus(order.id, "confirmed");
  }

  let updated = getOrder(order.id);
  if (updated?.location && !sellerHandled) {
    const plan = planFulfillment(updated.location);
    updated = applyFulfillmentPlan(order.id, plan) || getOrder(order.id);
  }

  await lockProductForOrder(updated);
  recordPurchaseFeedEvent(updated);
  await notifyBuyerPaid(updated, payment);
  await notifySellerDropoff(updated, label);

  console.log(
    `[escrow] PAID ${order.id} receipt=${payment.mpesaReceiptNumber || "—"} auto-fulfillment started`
  );

  return { order: getOrder(order.id), label };
}

/** Handle failed / cancelled STK. */
export async function applyPaymentFailure(checkoutRequestId, resultDesc = "") {
  const order = findOrderByCheckoutRequestId(checkoutRequestId) || null;
  if (!order) {
    console.warn("[escrow] STK failed — order not found for", checkoutRequestId);
    return null;
  }
  updateOrderMeta(order.id, {
    paymentStatus: "failed",
    lastPaymentError: resultDesc || "STK failed",
    stkFailedAt: Date.now(),
  });
  await sendText(
    order.customerKey,
    `⚠️ M-Pesa payment didn't go through for *${order.id}*.\n` +
      `${resultDesc ? `Reason: ${resultDesc}\n` : ""}` +
      `Reply *pay* to retry STK push, or type *menu* for help.`
  );
  return getOrder(order.id);
}

/** Resolve order from STK callback (CheckoutRequestID, then phone+amount fallback). */
export function resolveOrderFromStkCallback(parsed) {
  if (parsed.checkoutRequestId) {
    const byCheckout = findOrderByCheckoutRequestId(parsed.checkoutRequestId);
    if (byCheckout) return byCheckout;
  }
  if (parsed.phoneNumber && parsed.amount != null) {
    const byPhone = findProcessingOrderByPhoneAmount(parsed.phoneNumber, parsed.amount);
    if (byPhone) return byPhone;
  }
  if (parsed.accountReference) {
    const byRef = getOrder(parsed.accountReference);
    if (byRef) return byRef;
  }
  return null;
}

/** On courier delivery scan — schedule seller payout after escrow hold. */
export async function onOrderDelivered(order) {
  if (!order?.id) return;

  try {
    const { orderHasOpenDispute, orderHasDisputeHold } = await import("./disputes.js");
    if (orderHasDisputeHold(order) || (await orderHasOpenDispute(order.id))) {
      updateOrderMeta(order.id, {
        deliveredAt: Date.now(),
        disputeHold: true,
        escrowStatus: "held",
        payoutStatus: "held_for_dispute",
      });
      console.warn("[escrow] payout blocked — open dispute on", order.id);
      return;
    }
  } catch (err) {
    console.warn("[escrow] dispute check skipped:", err.message);
  }

  const eligibleAt = addBusinessDays(Date.now(), 3);
  updateOrderMeta(order.id, {
    escrowStatus: "released",
    deliveredAt: Date.now(),
    payoutEligibleAt: eligibleAt,
    payoutStatus: "scheduled",
  });
  scheduleSellerPayoutAfterDelivery(getOrder(order.id) || { ...order, payoutEligibleAt: eligibleAt });
}
