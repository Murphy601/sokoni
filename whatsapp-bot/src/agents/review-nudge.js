/**
 * Ask for a Trustpilot review one day after a clean escrow release.
 *
 * Orders live in the JSON record. There is no escrows table.
 * The job stays quiet until TRUSTPILOT_REVIEW_URL is an https trustpilot.com link,
 * so buyers are not sent to a page that has not been claimed.
 */

import { listAllOrders, updateOrderMeta } from "../services/orders.js";
import { buyerWhatsAppDestination } from "../services/buyer-whatsapp.js";

export const REVIEW_AFTER_MS = 24 * 60 * 60 * 1000;

export function reviewUrlAllowed(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.protocol === "https:" && /(^|\.)trustpilot\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function reviewAskDue(order, now = Date.now()) {
  if (!order?.id || order.kind === "cart_parent") return false;
  if (order.reviewRequestedAt) return false;
  if (order.disputeHold || order.adminTakeOver) return false;
  const escrow = String(order.escrowStatus || "").toLowerCase();
  if (escrow === "refunded" || escrow === "held" || escrow === "hold_upcountry") return false;
  if (order.payoutStatus === "held_for_dispute" || order.payoutStatus === "refunded") return false;
  if (escrow !== "released") return false;
  const completedAt = Number(order.buyerConfirmedAt || order.autoReleasedAt || order.deliveredAt || 0);
  if (!Number.isFinite(completedAt) || completedAt <= 0) return false;
  return now - completedAt >= REVIEW_AFTER_MS;
}

export function reviewAskText(order, reviewUrl) {
  return (
    `*${order.id}* is finished. Your M-Pesa payment stayed in escrow until the parcel was done.\n\n` +
    `If that was fair, 30 seconds on Trustpilot helps the next shopper:\n${reviewUrl}\n\n` +
    `If something was wrong, reply HELP ${order.id} and the seller payout stays held.`
  );
}

export async function processReviewAsks({
  now = Date.now(),
  orders = null,
  send = null,
  destination = null,
  reviewUrl = process.env.TRUSTPILOT_REVIEW_URL || "",
  markRequested = null,
  clearRequested = null,
  limit = 50,
} = {}) {
  if (!reviewUrlAllowed(reviewUrl)) return { sent: 0, reason: "no_review_url" };
  const list = (orders || listAllOrders()).filter((order) => reviewAskDue(order, now)).slice(0, limit);
  const deliver = send || (async (to, text) => {
    const { sendText } = await import("../services/whatsapp.js");
    return sendText(to, text);
  });
  const resolveTo = destination || buyerWhatsAppDestination;
  const stamp = markRequested || ((id) => updateOrderMeta(id, { reviewRequestedAt: Date.now() }));
  const unstamp = clearRequested || ((id) => updateOrderMeta(id, { reviewRequestedAt: null }));

  let sent = 0;
  for (const order of list) {
    const to = await resolveTo(order);
    if (!to || String(to).startsWith("web:")) continue;
    stamp(order.id);
    try {
      await deliver(to, reviewAskText(order, reviewUrl));
      sent += 1;
    } catch (err) {
      unstamp(order.id);
      console.warn("[review-nudge] send failed, will retry:", order.id, err?.message || err);
    }
  }
  return { sent, checked: list.length };
}
