import { config } from "../config.js";
import { updateOrderMeta } from "./orders.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import { isDarajaReady, initiateStkPush } from "./daraja-mpesa.js";
import { isPrepaidOnlyEffective } from "./platform-flags.js";

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

export function formatPrepaidCheckoutPrompt(order) {
  const total = orderBuyerTotal(order);
  const item = Math.round(Number(order?.priceKes) || 0);
  const ship = Math.round(Number(order?.shippingKes) || 0);
  const priceLine = Number.isFinite(total) ? `KES ${total.toLocaleString()}` : "—";
  const breakdown =
    ship > 0
      ? `Item KES ${item.toLocaleString()} + shipping KES ${ship.toLocaleString()} = *${priceLine}*\n`
      : "";
  const ref = order?.id || "SK-####";

  if (isDarajaConfigured()) {
    return (
      `💳 *Pay upfront — ${ref}*\n\n` +
      breakdown +
      `Total: *${priceLine}*\n` +
      `🔒 Funds stay in Sokoni escrow until delivery is confirmed.\n\n` +
      `📱 Check your phone — M-Pesa STK push sent.\n` +
      `Enter your PIN to complete payment.\n\n` +
      `_Payment confirms automatically — no admin step needed._` +
      (order?.id ? `\n\n🌐 Pay on web: ${checkoutUrlForOrder(order.id)}` : "")
    );
  }

  const till = config.store.mpesaTill;
  const tillName = config.store.mpesaTillName;
  return (
    `💳 *Pay upfront — ${ref}*\n\n` +
    breakdown +
    `Total: *${priceLine}*\n` +
    `Your money stays in Sokoni escrow until delivery is confirmed.\n\n` +
    `Configure Daraja STK for instant auto-confirm, or pay manually:\n\n` +
    `🏢 *Buy Goods Till:* ${till}\n` +
    `👤 *Registered to:* ${tillName}\n` +
    `📝 *Reference:* ${ref}\n\n` +
    (order?.id ? `🌐 Pay on web: ${checkoutUrlForOrder(order.id)}\n\n` : "") +
    `Reply *paid* after M-Pesa (manual verify until Daraja is live).`
  );
}

/**
 * Initiate M-Pesa STK push via Daraja; stores CheckoutRequestID on order.
 */
export async function initiateMpesaCheckout(order, { phone } = {}) {
  if (!order?.id) {
    return { ok: false, method: "invalid", message: "Missing order" };
  }

  if (order.customerPaymentStatus === "confirmed") {
    return { ok: true, method: "already_paid", alreadyPaid: true };
  }

  if (!isDarajaConfigured()) {
    return {
      ok: true,
      method: "manual_till",
      stkAvailable: false,
      till: config.store.mpesaTill,
      tillName: config.store.mpesaTillName,
      message: "Pay Buy Goods till with your order number as reference, then reply paid on WhatsApp.",
    };
  }

  const payPhone = phone || order.phone || order.mpesaPhone;
  if (!payPhone) {
    return { ok: false, method: "missing_phone", message: "No phone for STK push" };
  }

  try {
    updateOrderMeta(order.id, { paymentStatus: "processing" });
    const stk = await initiateStkPush({
      phone: payPhone,
      amount: orderBuyerTotal(order),
      accountReference: order.id,
      description: `Order ${order.id}`,
    });

    updateOrderMeta(order.id, {
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
    };
  } catch (err) {
    updateOrderMeta(order.id, {
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
    paymentMethods: isDarajaConfigured() ? ["mpesa_stk"] : ["manual_till"],
    till: config.store.mpesaTill || null,
    tillName: config.store.mpesaTillName || null,
    callbackUrl: config.mpesa.callbackUrl || null,
    note: isDarajaConfigured()
      ? "Daraja STK auto-confirms payment via webhook — no admin #payconfirm needed."
      : "Set MPESA_* env vars for automated STK. Manual till + #payconfirm until then.",
  };
}
