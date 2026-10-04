/**
 * Two hours after a delivery code matches, ask an admin to release escrow.
 *
 * The rider's own fee still clears on its 15-minute hold. This window is the
 * buyer's inspection of the item. The ticker only writes a pending action.
 * Approving that action is what calls the existing payout function.
 *
 * Orders delivered before this stamp existed are left alone. A backfill would
 * propose a release for every old order on the first tick.
 */

import { isDbEnabled } from "../db/pool.js";
import { listAllOrders } from "../services/orders.js";
import { orderHasOpenDispute } from "../services/disputes.js";
import { expireStaleActions, proposeAgentAction, queryOpenRelease } from "./agent-actions.js";

export const INSPECTION_WINDOW_MS = 2 * 60 * 60 * 1000;

export function inspectionDue(order, now = Date.now()) {
  if (!order?.id) return false;
  if (order.disputeHold || order.adminTakeOver) return false;
  if (order.isPaidOut) return false;
  const escrow = String(order.escrowStatus || "").toLowerCase();
  if (escrow === "released" || escrow === "refunded") return false;
  const started = Number(order.inspectionStartedAt);
  if (!Number.isFinite(started) || started <= 0) return false;
  return now - started >= INSPECTION_WINDOW_MS;
}

export async function processInspectionWindow(now = Date.now()) {
  let proposed = 0;
  let expired = 0;
  try {
    expired = await expireStaleActions();
  } catch (err) {
    console.warn("[inspection] expiry sweep skipped:", err?.message || err);
  }
  if (!isDbEnabled()) return { proposed, expired, reason: "no_db" };

  const orders = listAllOrders();
  for (const order of orders) {
    if (!inspectionDue(order, now)) continue;
    try {
      if (await orderHasOpenDispute(order.id)) continue;
      if (await queryOpenRelease(order.id)) continue;
      const result = await proposeAgentAction({
        actionType: "RELEASE_ESCROW",
        orderId: order.id,
        reason: "2-hour inspection ended with no dispute",
        agentName: "EscrowAgent",
      });
      if (result?.ok) proposed += 1;
    } catch (err) {
      console.warn("[inspection] proposal skipped:", order.id, err?.message || err);
    }
  }
  if (proposed) console.log(`[inspection] proposed ${proposed} escrow release(s)`);
  return { proposed, expired };
}
