/**
 * Seller PARTIAL_REFUND SKN-#### amount — partial escrow release inside hold window.
 */
import { getOrder, normalizeOrderId, updateOrderMeta } from "./orders.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import { isB2CReady, initiateB2CPayout } from "./daraja-mpesa.js";

function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d.length >= 12 && d.length <= 15 ? d : "";
}

/**
 * @param {{ orderId: string, amountKes: number, sellerPhone?: string, customerKey?: string }} opts
 */
export async function handlePartialEscrowRefund({
  orderId,
  amountKes,
  sellerPhone = "",
  customerKey = "",
} = {}) {
  const id = normalizeOrderId(orderId);
  const refundValue = Math.round(Number(amountKes));
  if (!id) {
    return { error: "invalid", message: "Use format: PARTIAL_REFUND SKN-1234 500" };
  }
  if (!Number.isFinite(refundValue) || refundValue < 1) {
    return { error: "invalid_amount", message: "Refund amount must be a positive KES number." };
  }

  const order = getOrder(id);
  if (!order) return { error: "not_found", message: `Order *${id}* not found.` };

  const {
    authorizeSellerForOrder,
    isPaidHeld,
    isAdminTakeOver,
  } = await import("./communication-hub.js");

  if (isAdminTakeOver(order) || order.disputeHold) {
    return { error: "support_hold", message: `*${id}* is with Sokoni support — partial refund paused.` };
  }

  const auth = await authorizeSellerForOrder(order, sellerPhone, customerKey);
  const fresh = auth.order || order;
  if (!auth.ok) {
    return {
      error: "forbidden",
      message: `*${id}* is not linked to your seller shop.`,
    };
  }

  const escrow = String(fresh.escrowStatus || "").toLowerCase();
  const held =
    isPaidHeld(fresh) ||
    escrow === "held" ||
    escrow === "hold_upcountry" ||
    escrow === "pending";
  if (!held || escrow === "refunded" || escrow === "released") {
    return {
      error: "escrow_closed",
      message: `⚠️ Escrow for *${id}* is no longer on hold (${escrow || "unknown"}).`,
    };
  }

  const itemPrice = Math.round(Number(fresh.priceKes || fresh.sourcePriceKes || 0));
  const buyerTotal = Math.round(Number(orderBuyerTotal(fresh) || 0));
  const alreadyPartial = Math.round(Number(fresh.partialRefundKes || 0));
  const maxRefund = Math.max(0, (itemPrice || buyerTotal) - alreadyPartial - 1);
  if (refundValue >= (itemPrice || buyerTotal) - alreadyPartial) {
    return {
      error: "too_large",
      message:
        `⚠️ Partial refund cannot be ≥ remaining item value (KES ${(itemPrice - alreadyPartial).toLocaleString()}).\n` +
        `For a full cancellation ask Sokoni support / use HELP.`,
    };
  }
  if (refundValue > maxRefund && maxRefund > 0) {
    return {
      error: "too_large",
      message: `Max partial refund now is KES ${maxRefund.toLocaleString()}.`,
    };
  }

  const newItemPrice = Math.max(0, itemPrice - refundValue);
  const prevSellerNet = Math.round(
    Number(fresh.sellerNetKes ?? fresh.sellerPayoutKes ?? fresh.sourcePriceKes ?? itemPrice * 0.9)
  );
  const newSellerNet = Math.max(0, prevSellerNet - refundValue);

  let b2c = null;
  const buyerPhone = normalizePhone(fresh.phone || fresh.mpesaPhone || fresh.customerPhone);
  if (isB2CReady() && buyerPhone) {
    try {
      b2c = await initiateB2CPayout({
        phone: buyerPhone,
        amount: refundValue,
        remarks: `Sokoni partial refund ${id}`,
        occasion: "PartialRefund",
        orderId: id,
        originatorConversationId: `sknpartial${String(id).replace(/\D/g, "").slice(0, 12)}${Date.now().toString(36).slice(-4)}`,
      });
    } catch (err) {
      console.warn("[partial-refund] B2C:", err.message);
      b2c = { ok: false, message: err.message };
    }
  }

  const b2cOk = Boolean(b2c?.ok);
  updateOrderMeta(id, {
    priceKes: newItemPrice,
    sellerNetKes: newSellerNet,
    sellerPayoutKes: newSellerNet,
    sourcePriceKes: newSellerNet,
    partialRefundKes: alreadyPartial + refundValue,
    partialRefundAt: Date.now(),
    lastPartialRefundKes: refundValue,
    partialRefundB2c: b2cOk,
    ...(b2cOk
      ? {}
      : {
          refundPendingManual: true,
          refundReason: `Partial refund KES ${refundValue} pending manual M-Pesa (order ${id})`,
        }),
    escrowStatus: escrow === "hold_upcountry" ? "hold_upcountry" : "held",
  });

  // Shrink settlement line if present
  try {
    const { adjustSettlementPayoutAmount } = await import("./settlements.js");
    if (typeof adjustSettlementPayoutAmount === "function") {
      adjustSettlementPayoutAmount(id, newSellerNet);
    }
  } catch {
    /* optional helper may not exist */
  }

  const { sendText } = await import("./whatsapp.js");
  if (fresh.customerKey) {
    try {
      await sendText(
        fresh.customerKey,
        `💰 *PARTIAL REFUND (Order ${id})*\n\n` +
          `The seller issued a partial refund of *KES ${refundValue.toLocaleString()}*.\n` +
          `• Adjusted item balance: *KES ${newItemPrice.toLocaleString()}*\n` +
          (b2cOk
            ? `• M-Pesa B2C initiated to your phone.\n`
            : `• Refund is queued for M-Pesa (ops will complete if auto-pay is offline).\n`)
      );
    } catch (err) {
      console.warn("[partial-refund] buyer notify:", err.message);
    }
  }

  return {
    ok: true,
    refundKes: refundValue,
    newItemPrice,
    newSellerNet,
    b2cOk,
    message:
      `✅ *PARTIAL REFUND PROCESSED!* KES ${refundValue.toLocaleString()} ` +
      (b2cOk ? "sent via M-Pesa B2C" : "queued for M-Pesa") +
      `.\nRemaining item balance under escrow: *KES ${newItemPrice.toLocaleString()}*.`,
  };
}

export async function tryHandlePartialRefundMessage(customerKey, text, { phone = "" } = {}) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(
    /^PARTIAL[_ ]?REFUND\s+(SKN?-?\d{1,6}(?:-\d+)?)\s+(\d+(?:\.\d+)?)\b/i
  );
  if (!match) return false;

  const result = await handlePartialEscrowRefund({
    orderId: match[1],
    amountKes: match[2],
    sellerPhone: phone,
    customerKey,
  });
  const { sendText } = await import("./whatsapp.js");
  await sendText(customerKey, result.message || result.error || "Could not process partial refund.");
  return true;
}
