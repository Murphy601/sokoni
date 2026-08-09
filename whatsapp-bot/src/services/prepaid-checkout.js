import { config } from "../config.js";
import { getOrder, updateOrderMeta } from "./orders.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import { isDarajaReady, initiateStkPush } from "./daraja-mpesa.js";
import { isPrepaidOnlyEffective, isMultiSellerCartEnabled } from "./platform-flags.js";
import { ensureHybridShippingBeforePayment } from "./apply-order-shipping.js";

export const ESCROW_STATUSES = ["pending", "held", "released", "refunded"];

export function isPrepaidOnly() {
  return isPrepaidOnlyEffective();
}

export function isDarajaConfigured() {
  return isDarajaReady();
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

  if (isDarajaConfigured()) {
    return `💳 *${ref}* — *${priceLine}*${shipBit}\nSTK sent — enter M-Pesa PIN.`;
  }

  return (
    `💳 *${ref}* — *${priceLine}*${shipBit}\n` +
    `Open checkout to pay via M-Pesa STK, then reply *paid* if needed.` +
    (order?.id ? `\n${checkoutUrlForOrder(order.id)}` : "")
  );
}

/**
 * Initiate M-Pesa STK push via Daraja; stores CheckoutRequestID on order.
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

  if (!isDarajaConfigured()) {
    return {
      ok: true,
      method: "manual_till",
      stkAvailable: false,
      message:
        "M-Pesa STK is briefly unavailable — open your checkout link on sokonimall.com or reply *paid* with your M-Pesa code on WhatsApp.",
    };
  }

  const payPhone = phone || order.phone || order.mpesaPhone;
  if (!payPhone) {
    return { ok: false, method: "missing_phone", message: "No phone for STK push" };
  }

  // Hybrid logistics: fold seller county/tier rates into total before Daraja STK.
  let payOrder = order;
  try {
    const ensured = await ensureHybridShippingBeforePayment(order);
    if (ensured?.order) payOrder = ensured.order;
    else payOrder = getOrder(order.id) || order;
  } catch (err) {
    console.warn("[checkout] hybrid shipping ensure skipped:", err?.message || err);
    payOrder = getOrder(order.id) || order;
  }

  try {
    updateOrderMeta(payOrder.id, { paymentStatus: "processing" });
    const stk = await initiateStkPush({
      phone: payPhone,
      amount: orderBuyerTotal(payOrder),
      accountReference: payOrder.id,
      description: `Order ${payOrder.id}`,
    });

    updateOrderMeta(payOrder.id, {
      checkoutRequestId: stk.checkoutRequestId,
      merchantRequestId: stk.merchantRequestId,
      paymentStatus: "processing",
      stkSentAt: Date.now(),
    });

    return {
      ok: true,
      method: "mpesa_stk",
      stkAvailable: true,
      checkoutRequestId: stk.checkoutRequestId,
      customerMessage: stk.customerMessage,
      amountKes: orderBuyerTotal(payOrder),
      shippingKes: Math.round(Number(payOrder.shippingKes) || 0),
    };
  } catch (err) {
    updateOrderMeta(payOrder.id, {
      paymentStatus: "failed",
      lastPaymentError: err.message,
    });
    return { ok: false, method: "stk_error", message: err.message };
  }
}

export function checkoutMeta() {
  return {
    prepaidOnly: isPrepaidOnly(),
    darajaConfigured: isDarajaConfigured(),
    darajaIntegration: isDarajaConfigured() ? "stk_active" : "manual_fallback",
    escrow: true,
    autoConfirm: isDarajaConfigured(),
    multiSellerCart: isMultiSellerCartEnabled(),
    cartIdFormat: "SKN-#### (+ SKN-####-n children)",
    paymentMethods: isDarajaConfigured() ? ["mpesa_stk"] : ["whatsapp_paid"],
    // Do not expose till / till account name on public checkout meta.
    note: isDarajaConfigured()
      ? "Daraja STK auto-confirms payment via webhook — no admin #payconfirm needed."
      : "STK env not configured — buyers retry STK or reply paid on WhatsApp.",
  };
}
