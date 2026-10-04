/**
 * The buyer ends their own inspection.
 *
 * This is the person who paid, not an agent. It still goes through the payout
 * function that checks the order is delivered and not already paid out.
 */

import { getOrder, updateOrderMeta } from "./orders.js";

export function buyerCanRelease(order) {
  if (!order?.id) return false;
  if (order.disputeHold || order.adminTakeOver || order.isPaidOut) return false;
  const escrow = String(order.escrowStatus || "").toLowerCase();
  if (escrow === "released" || escrow === "refunded") return false;
  if (order.customerPaymentStatus !== "confirmed" && !order.paid) return false;
  return order.status === "delivered" || Number(order.inspectionStartedAt) > 0;
}

export async function releaseFundsNow(order, { via = "buyer" } = {}) {
  const current = order?.id ? getOrder(order.id) || order : null;
  if (!buyerCanRelease(current)) {
    return { error: "not_ready", message: "That order is not ready to release." };
  }
  const { releaseEscrowPayout } = await import("./seller-onboard.js");
  const result = await releaseEscrowPayout(current.id);
  if (result?.error) {
    return { error: result.error, message: result.message || "Could not release that order." };
  }
  updateOrderMeta(current.id, {
    buyerConfirmedAt: Date.now(),
    buyerConfirmedVia: String(via || "buyer").slice(0, 40),
  });
  const fresh = getOrder(current.id) || current;
  try {
    const { postEscrowCard } = await import("./escrow-chat-cards.js");
    void postEscrowCard(fresh, "released");
  } catch (err) {
    console.warn("[buyer-release] card skipped:", err?.message || err);
  }
  try {
    const { inviteFitCheck } = await import("./fit-check.js");
    void inviteFitCheck(fresh);
  } catch (err) {
    console.warn("[buyer-release] fit check skipped:", err?.message || err);
  }
  return { ok: true, orderId: current.id };
}
