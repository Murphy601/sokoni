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
import {
  dispatchMessages,
  msgBuyerPaid,
  msgSellerPaid,
  notifyAdminEvent,
  sellerNotifyTargets,
} from "./communication-hub.js";

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
  const receipt = payment.mpesaReceiptNumber || "—";
  const base = msgBuyerPaid(order);
  const withReceipt =
    `Receipt: *${receipt}* · KES ${Number(amt).toLocaleString()}\n\n` + base;
  if (order.customerKey) {
    void dispatchMessages([{ to: order.customerKey, message: withReceipt }]);
  }
}

async function notifySellerDropoff(order, label) {
  if (!order.supplierId) return;
  const sup = getSupplier(order.supplierId);
  if (!sup?.phone) return;
  const sellerHandled =
    order.shippingRecipient === "seller" ||
    order.deliveryMethod === "seller_express" ||
    order.deliveryMethod === "meetup";

  let message = msgSellerPaid(order);
  if (!sellerHandled && label?.dropOffCode) {
    message +=
      `\n\nHub label: *${label.dropOffCode}*\n` +
      `Label / QR: ${label.labelUrl || "—"}\n` +
      `(Hub scan also works — or reply DISPATCH ${order.id} yourself.)`;
  }
  const targets = sellerNotifyTargets(sup.phone);
  updateOrderMeta(order.id, { sellerNotifyChatIds: targets });
  void dispatchMessages(targets.map((to) => ({ to, message })));
  void notifyAdminEvent("PAID_ESCROW", {
    orderId: order.id,
    details: `Payment held — seller notified to DISPATCH ${order.id}`,
    silent: true,
  });
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

  // Sticky social seller id for reviews / auto ratings.
  try {
    const { ensureOrderSellerUserId } = await import("../db/repositories/social.js");
    await ensureOrderSellerUserId(updated);
    updated = getOrder(order.id) || updated;
  } catch (err) {
    console.warn("[escrow] sellerUserId resolve skipped:", err.message);
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
