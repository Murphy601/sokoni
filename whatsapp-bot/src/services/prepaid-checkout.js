/**
 * Phase 5 — Prepaid-only checkout with escrow hold.
 * Safaricom Daraja STK push will plug in here (see initiateMpesaCheckout).
 */
import { config } from "../config.js";

export const ESCROW_STATUSES = ["pending", "held", "released", "refunded"];

/** Local catalog orders are prepaid-only unless explicitly disabled. */
export function isPrepaidOnly() {
  return config.store.prepaidOnly !== false;
}

export function isDarajaConfigured() {
  const mpesa = config.mpesa || {};
  return Boolean(mpesa.consumerKey && mpesa.consumerSecret && mpesa.passkey && mpesa.shortcode);
}

/** Fulfillment / supplier notify requires upfront payment verified. */
export function canFulfillOrder(order) {
  if (!order || order.status === "cancelled") return false;
  if (!isPrepaidOnly() || order.paymentModel === "cod") return true;
  return order.customerPaymentStatus === "confirmed";
}

export function prepaidPaymentLine(order) {
  if (!order) return "";
  if (order.customerPaymentStatus === "confirmed") return "✅ Paid — escrow held";
  if (order.customerPaymentStatus === "claimed") return "⏳ Payment verifying";
  return "💳 Pay upfront (escrow)";
}

export function formatPrepaidCheckoutPrompt(order) {
  const till = config.store.mpesaTill;
  const tillName = config.store.mpesaTillName;
  const amt = Number(order?.priceKes);
  const priceLine = Number.isFinite(amt) ? `KES ${amt.toLocaleString()}` : "—";
  const ref = order?.id || "SK-####";

  const stkLine = isDarajaConfigured()
    ? "📱 *M-Pesa STK push* will arrive on your phone shortly (Safaricom Daraja)."
    : "📱 *M-Pesa STK push* via Safaricom Daraja is coming soon — pay manually for now:";

  return (
    `💳 *Pay upfront — ${ref}*\n\n` +
    `Amount: *${priceLine}*\n` +
    `Your money stays in Sokoni escrow until delivery is confirmed.\n\n` +
    `${stkLine}\n\n` +
    `🏢 *Buy Goods Till:* ${till}\n` +
    `👤 *Registered to:* ${tillName}\n` +
    `📝 *Account reference:* ${ref}\n\n` +
    `After paying, reply *paid* with your M-Pesa confirmation code.\n` +
    `We pack & dispatch only after payment is verified. 🔒\n\n` +
    `_No pay-on-delivery. No COD._`
  );
}

/**
 * Initiate M-Pesa collection. Daraja STK wired in Phase 5.1.
 * @returns {Promise<{ ok: boolean, method: string, stkAvailable?: boolean, message?: string }>}
 */
export async function initiateMpesaCheckout(order) {
  if (!order?.id) {
    return { ok: false, method: "invalid", message: "Missing order" };
  }

  if (isDarajaConfigured()) {
    // Phase 5.1 — POST to Daraja STK push, store CheckoutRequestID on order
    return {
      ok: false,
      method: "daraja_pending",
      stkAvailable: false,
      message: "Daraja STK integration pending — use manual till payment with order reference.",
    };
  }

  return { ok: true, method: "manual_till", stkAvailable: false };
}

export function checkoutMeta() {
  return {
    prepaidOnly: isPrepaidOnly(),
    darajaConfigured: isDarajaConfigured(),
    darajaIntegration: "planned",
    escrow: true,
    paymentMethods: isDarajaConfigured()
      ? ["mpesa_stk", "manual_till"]
      : ["manual_till"],
    note: "100% prepaid escrow. Safaricom Daraja STK push will replace manual till when configured.",
  };
}
