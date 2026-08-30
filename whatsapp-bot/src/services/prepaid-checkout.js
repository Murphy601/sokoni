import { config } from "../config.js";
import { getOrder, updateOrderMeta, listAllOrders, updateOrderStatus } from "./orders.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import { isDarajaReady, initiateStkPush } from "./daraja-mpesa.js";
import {
  isPaystackCollectReady,
  resolveCollectRail,
  initiatePaystackMpesaCharge,
  buyerChargeEmail,
  paystackReference,
} from "./paystack-transfers.js";
import { isPrepaidOnlyEffective, isMultiSellerCartEnabled } from "./platform-flags.js";
import { ensureHybridShippingBeforePayment } from "./apply-order-shipping.js";
import { gateShippingBeforeStk } from "./shipping-gate.js";
import { STK_TIMEOUT_MS } from "../lib/ops-edge-constants.js";

export const ESCROW_STATUSES = ["pending", "held", "released", "refunded"];

export function isPrepaidOnly() {
  return isPrepaidOnlyEffective();
}

export function isDarajaConfigured() {
  return isDarajaReady();
}

/** STK fires via Paystack Charge. Daraja only if PAYSTACK_ONLY=false. */
export function isStkConfigured() {
  return resolveCollectRail(isDarajaReady()) !== "manual";
}

export function collectPaymentRail() {
  return resolveCollectRail(isDarajaReady());
}

export function canFulfillOrder(order) {
  if (!order || order.status === "cancelled") return false;
  if (!isPrepaidOnly() || order.paymentModel === "cod") return true;
  return order.customerPaymentStatus === "confirmed";
}

export function prepaidPaymentLine(order) {
  if (!order) return "";
  if (order.customerPaymentStatus === "confirmed") return "✅ Paid — escrow held";
  if (order.customerPaymentStatus === "claimed") return "⏳ Payment verifying";
  if (order.paymentStatus === "processing") return "📱 STK sent — enter PIN";
  if (order.paymentStatus === "payment_expired" || order.status === "payment_expired") {
    return "⌛ STK expired — reply *pay* to retry";
  }
  return "💳 Pay upfront (escrow)";
}

export function checkoutUrlForOrder(orderId) {
  const base = config.publicSiteUrl || "https://sokonimall.com";
  return `${base}/checkout.html?order=${encodeURIComponent(orderId || "")}`;
}

/** Printable prepaid drop-off label (seller hub scan). */
export function labelPageUrlForOrder(orderId) {
  const base = config.publicSiteUrl || "https://sokonimall.com";
  return `${base}/label.html?order=${encodeURIComponent(orderId || "")}`;
}

export function formatPrepaidCheckoutPrompt(order) {
  const total = orderBuyerTotal(order);
  const ship = Math.round(Number(order?.shippingKes) || 0);
  const priceLine = Number.isFinite(total) ? `KES ${total.toLocaleString()}` : "—";
  const ref = order?.id || "SKN-####";
  const shipBit = ship > 0 ? ` · delivery KES ${ship.toLocaleString()}` : "";

  if (isStkConfigured()) {
    return `💳 *${ref}* — *${priceLine}*${shipBit}\nSTK sent — enter M-Pesa PIN.`;
  }

  return (
    `💳 *${ref}* — *${priceLine}*${shipBit}\n` +
    `Open checkout to pay via M-Pesa STK, then reply *paid* if needed.` +
    (order?.id ? `\n${checkoutUrlForOrder(order.id)}` : "")
  );
}

/**
 * Initiate M-Pesa STK — Paystack Charge. Does not fall back to Daraja.
 * Stores Paystack reference on the order for webhook match.
 */
export async function initiateMpesaCheckout(order, { phone } = {}) {
  if (!order?.id) {
    return { ok: false, method: "invalid", message: "Missing order" };
  }

  if (order.kind === "cart_child") {
    return {
      ok: false,
      method: "pay_parent",
      message: `Pay the parent cart order ${order.parentOrderId || "SKN-####"} — not the child line.`,
    };
  }

  if (order.customerPaymentStatus === "confirmed") {
    return { ok: true, method: "already_paid", alreadyPaid: true };
  }

  const rail = collectPaymentRail();
  if (rail === "manual") {
    return {
      ok: true,
      method: "manual_till",
      stkAvailable: false,
      paymentRail: "manual",
      message:
        "M-Pesa STK is briefly unavailable — open your checkout link on sokonimall.com or reply *paid* with your M-Pesa code on WhatsApp.",
    };
  }

  const payPhone = phone || order.phone || order.mpesaPhone;
  if (!payPhone) {
    return { ok: false, method: "missing_phone", message: "No phone for STK push" };
  }

  // Hybrid logistics: require seller Hub shipping rates before any STK push.
  let payOrder = order;
  try {
    const gated = await gateShippingBeforeStk(order);
    if (!gated.ok) {
      return {
        ok: false,
        method: "shipping_blocked",
        cancelled: Boolean(gated.cancelled),
        error: gated.error || "missing_shipping_rates",
        message:
          gated.message ||
          "Order cancelled — seller has not set delivery rates for this area. No funds were deducted.",
      };
    }
    payOrder = gated.order || getOrder(order.id) || order;
  } catch (err) {
    console.warn("[checkout] shipping gate skipped:", err?.message || err);
    try {
      const ensured = await ensureHybridShippingBeforePayment(order);
      if (ensured?.order) payOrder = ensured.order;
      else payOrder = getOrder(order.id) || order;
    } catch (err2) {
      console.warn("[checkout] hybrid shipping ensure skipped:", err2?.message || err2);
      payOrder = getOrder(order.id) || order;
    }
  }

  const amountKes = orderBuyerTotal(payOrder);
  const shippingKes = Math.round(Number(payOrder.shippingKes) || 0);

  if (rail === "paystack") {
    const charged = await initiatePaystackChargeForOrder(payOrder, { phone: payPhone, amountKes });
    if (charged.ok) return { ...charged, shippingKes };
    updateOrderMeta(payOrder.id, {
      paymentStatus: "failed",
      lastPaymentError: charged.message,
    });
    return { ok: false, method: "stk_error", paymentRail: "paystack", message: charged.message };
  }

  try {
    updateOrderMeta(payOrder.id, { paymentStatus: "processing", paymentRail: "daraja" });
    const stk = await initiateStkPush({
      phone: payPhone,
      amount: amountKes,
      accountReference: payOrder.id,
      description: `Order ${payOrder.id}`,
    });

    updateOrderMeta(payOrder.id, {
      checkoutRequestId: stk.checkoutRequestId,
      merchantRequestId: stk.merchantRequestId,
      paymentStatus: "processing",
      paymentRail: "daraja",
      stkSentAt: Date.now(),
    });

    return {
      ok: true,
      method: "mpesa_stk",
      paymentRail: "daraja",
      stkAvailable: true,
      checkoutRequestId: stk.checkoutRequestId,
      customerMessage: stk.customerMessage,
      amountKes,
      shippingKes,
    };
  } catch (err) {
    updateOrderMeta(payOrder.id, {
      paymentStatus: "failed",
      lastPaymentError: err.message,
    });
    return { ok: false, method: "stk_error", paymentRail: "daraja", message: err.message };
  }
}

async function initiatePaystackChargeForOrder(payOrder, { phone, amountKes }) {
  updateOrderMeta(payOrder.id, { paymentStatus: "processing", paymentRail: "paystack" });
  const reference = paystackReference({ orderId: payOrder.id, withdrawId: "pay" });
  const charge = await initiatePaystackMpesaCharge({
    email: buyerChargeEmail(payOrder),
    amountKes,
    phone,
    reference,
    metadata: { orderId: payOrder.id },
  });
  if (!charge.ok) return charge;

  updateOrderMeta(payOrder.id, {
    checkoutRequestId: charge.reference,
    paystackReference: charge.reference,
    merchantRequestId: charge.data?.id || null,
    paymentStatus: "processing",
    paymentRail: "paystack",
    stkSentAt: Date.now(),
  });

  return {
    ok: true,
    method: "mpesa_stk",
    paymentRail: "paystack",
    stkAvailable: true,
    checkoutRequestId: charge.reference,
    paystackReference: charge.reference,
    customerMessage: charge.displayText || "STK sent — enter M-Pesa PIN on your phone.",
    amountKes,
  };
}

export function checkoutMeta() {
  const rail = collectPaymentRail();
  const stkLive = rail !== "manual";
  return {
    prepaidOnly: isPrepaidOnly(),
    darajaConfigured: stkLive,
    stkAvailable: stkLive,
    paymentRail: rail,
    paystackConfigured: isPaystackCollectReady(),
    paystackOnly: config.paystack?.only !== false,
    darajaIntegration: stkLive ? "stk_active" : "manual_fallback",
    escrow: true,
    autoConfirm: stkLive,
    multiSellerCart: isMultiSellerCartEnabled(),
    cartIdFormat: "SKN-#### (+ SKN-####-n children)",
    paymentMethods: stkLive ? ["mpesa_stk"] : ["whatsapp_paid"],
    // Do not expose till / till account name on public checkout meta.
    note: stkLive
      ? "M-Pesa STK auto-confirms payment via webhook — no admin #payconfirm needed."
      : "STK env not configured — buyers retry STK or reply paid on WhatsApp.",
  };
}

/**
 * Expire STK pushes with no successful callback within 180s.
 * Marks PAYMENT_EXPIRED. Inventory was never hard-locked until pay succeeded.
 */
export function expireStaleStkPayments({ olderThanMs = null, limit = 40 } = {}) {
  const ttl = olderThanMs != null ? Number(olderThanMs) : STK_TIMEOUT_MS;
  const now = Date.now();
  let expired = 0;

  const candidates = listAllOrders()
    .filter((o) => {
      if (o.customerPaymentStatus === "confirmed") return false;
      if (o.paymentStatus === "payment_expired" || o.status === "payment_expired") return false;
      if (o.status === "cancelled" || o.status === "delivered") return false;
      if (o.paymentStatus !== "processing") return false;
      const sentAt = Number(o.stkSentAt || 0);
      if (!sentAt) return false;
      return now - sentAt >= ttl;
    })
    .slice(0, Math.min(Math.max(Number(limit) || 40, 1), 100));

  for (const o of candidates) {
    updateOrderMeta(o.id, {
      paymentStatus: "payment_expired",
      stkExpiredAt: now,
      lastPaymentError: "STK timeout — no successful callback within 180s",
      inventoryUnlocked: true,
    });
    try {
      updateOrderStatus(o.id, "payment_expired");
    } catch {
      /* some environments only allow a fixed status set — meta is enough */
    }
    expired += 1;
    console.log(
      `[checkout] STK expired ${o.id} after ${Math.round((now - Number(o.stkSentAt)) / 1000)}s`
    );
  }
  return { expired };
}
