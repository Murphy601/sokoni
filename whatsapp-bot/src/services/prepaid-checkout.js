import { config } from "../config.js";
import { getOrder, updateOrderMeta } from "./orders.js";
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

export const ESCROW_STATUSES = ["pending", "held", "released", "refunded"];

export function isPrepaidOnly() {
  return isPrepaidOnlyEffective();
}

export function isDarajaConfigured() {
  return isDarajaReady();
}

/** STK can fire via Paystack charge or Daraja. */
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
 * Initiate M-Pesa STK — Paystack Charge when keyed, else Daraja.
 * Stores CheckoutRequestID (or Paystack reference) on the order for webhook match.
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

  // Hybrid logistics: fold seller county/tier rates into total before STK.
  let payOrder = order;
  try {
    const ensured = await ensureHybridShippingBeforePayment(order);
    if (ensured?.order) payOrder = ensured.order;
    else payOrder = getOrder(order.id) || order;
  } catch (err) {
    console.warn("[checkout] hybrid shipping ensure skipped:", err?.message || err);
    payOrder = getOrder(order.id) || order;
  }

  const amountKes = orderBuyerTotal(payOrder);
  const shippingKes = Math.round(Number(payOrder.shippingKes) || 0);

  if (rail === "paystack") {
    const charged = await initiatePaystackChargeForOrder(payOrder, { phone: payPhone, amountKes });
    if (charged.ok) return { ...charged, shippingKes };
    if (isDarajaReady()) {
      console.warn("[checkout] Paystack charge failed — falling back to Daraja:", charged.message);
    } else {
      updateOrderMeta(payOrder.id, {
        paymentStatus: "failed",
        lastPaymentError: charged.message,
      });
      return { ok: false, method: "stk_error", paymentRail: "paystack", message: charged.message };
    }
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
