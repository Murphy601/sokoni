/**
 * If a seller has not dispatched 12 hours after payment, the buyer is refunded.
 *
 * Only orders stamped with a deadline at payment time are eligible. Older
 * orders are left alone, so the first run cannot refund the whole history.
 * When M-Pesa B2C is offline the escrow is still closed and the send is queued
 * for a person. The reply never invents a receipt code.
 */

import { getOrder, updateOrderMeta } from "./orders.js";
import { orderBuyerTotal } from "./shipping-tiers.js";

export const DISPATCH_DEADLINE_MS = 12 * 60 * 60 * 1000;

export function stampDispatchDeadline(paidAt = Date.now()) {
  const t = Number(paidAt);
  if (!Number.isFinite(t) || t <= 0) return null;
  return t + DISPATCH_DEADLINE_MS;
}

function buyerPhone(order) {
  let d = String(order?.phone || order?.mpesaPhone || order?.customerPhone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d.length >= 12 && d.length <= 15 ? d : "";
}

export function refundDue(order, now = Date.now()) {
  if (!order?.id) return false;
  const deadline = Number(order.dispatchDeadlineAt);
  if (!Number.isFinite(deadline) || deadline <= 0 || now < deadline) return false;
  if (order.autoRefundAt || order.sellerDispatchedAt || order.inTransitAt) return false;
  if (order.disputeHold || order.isPaidOut) return false;
  const escrow = String(order.escrowStatus || "").toLowerCase();
  if (escrow === "released" || escrow === "refunded") return false;
  if (order.customerPaymentStatus !== "confirmed" && !order.paid) return false;
  return true;
}

export async function refundIfSellerMissedDispatch(order, { now = Date.now(), sendB2c = null } = {}) {
  const current = order?.id ? getOrder(order.id) || order : null;
  if (!refundDue(current, now)) return { skipped: true };
  const amount = Math.round(Number(orderBuyerTotal(current)) || 0);
  if (amount < 1) return { skipped: true, reason: "no_amount" };

  updateOrderMeta(current.id, { autoRefundAt: now, autoRefundKes: amount });

  let sent = false;
  const phone = buyerPhone(current);
  if (phone) {
    try {
      const payer = sendB2c || (async (args) => {
        const { isB2CReady, initiateB2CPayout } = await import("./daraja-mpesa.js");
        if (!isB2CReady()) return { ok: false };
        return initiateB2CPayout({
          phone: args.phone,
          amount: args.amount,
          remarks: `Sokoni refund ${args.orderId}`.slice(0, 100),
          occasion: "BuyerRefund",
          orderId: args.orderId,
          originatorConversationId: `sknrefund${String(args.orderId).replace(/\D/g, "").slice(0, 10)}${Date.now().toString(36).slice(-4)}`,
        });
      });
      const result = await payer({ phone, amount, orderId: current.id });
      sent = Boolean(result?.ok);
    } catch (err) {
      console.warn("[undispatched-refund] M-Pesa send skipped:", err?.message || err);
    }
  }

  updateOrderMeta(current.id, {
    escrowStatus: "refunded",
    payoutStatus: "refunded",
    status: "cancelled",
    autoRefundB2c: sent,
    refundPendingManual: !sent,
    refundReason: sent
      ? "Seller did not dispatch within 12 hours."
      : "Seller did not dispatch within 12 hours. M-Pesa send is queued.",
  });

  try {
    const { cancelSettlementPayout } = await import("./settlements.js");
    cancelSettlementPayout(current.id, "seller_missed_dispatch");
  } catch (err) {
    console.warn("[undispatched-refund] settlement cancel skipped:", err?.message || err);
  }

  const fresh = getOrder(current.id) || current;
  try {
    const { postEscrowCard } = await import("./escrow-chat-cards.js");
    void postEscrowCard(fresh, "refunded");
  } catch (err) {
    console.warn("[undispatched-refund] card skipped:", err?.message || err);
  }

  const text = sent
    ? `↩️ *Refund started for ${current.id}*\nThe seller did not dispatch within 12 hours. KES ${amount.toLocaleString("en-KE")} is on the way back to your M-Pesa. No fee.`
    : `↩️ *Refund queued for ${current.id}*\nThe seller did not dispatch within 12 hours. KES ${amount.toLocaleString("en-KE")} stays out of the seller's payout. Sokoni will send it to your M-Pesa. No fee.`;

  if (current.customerKey) {
    try {
      const { sendText } = await import("./whatsapp.js");
      await sendText(current.customerKey, text);
    } catch (err) {
      console.warn("[undispatched-refund] buyer note skipped:", err?.message || err);
    }
  }
  try {
    const { notifyAdminEvent } = await import("./communication-hub.js");
    await notifyAdminEvent("DISPUTE_OR_HELP", {
      orderId: current.id,
      details: sent
        ? `Auto-refund started. Seller missed the 12-hour dispatch window. KES ${amount}.`
        : `Auto-refund queued. B2C was not ready. Seller missed the 12-hour dispatch window. KES ${amount}.`,
    });
  } catch (err) {
    console.warn("[undispatched-refund] admin note skipped:", err?.message || err);
  }

  return { ok: true, sent, amount };
}
