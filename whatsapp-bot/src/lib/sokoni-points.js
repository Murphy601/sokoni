/**
 * Sokoni Points economy — low earn rates, redeem at threshold.
 * 1000 points ≈ KES 100 store credit (10 pts = KES 1).
 */

export const POINTS_REDEEM_THRESHOLD = 1000;
export const POINTS_REDEEM_KES = 100;
export const POINTS_PER_KES = POINTS_REDEEM_THRESHOLD / POINTS_REDEEM_KES; // 10

/** Low but promising earn table */
export const POINTS_EARN = Object.freeze({
  BUYER_ORDER_COMPLETE: 8,
  SELLER_ORDER_COMPLETE: 10,
  SELLER_BADGE_LEVEL_UP: 25,
  RIDER_DELIVERY: 5,
  RIDER_DAILY_QUEST: 40, // complete 8 deliveries in a day
  PAMOJA_JOIN: 5,
  PAMOJA_FILL_LEADER: 20,
  PAMOJA_FILL_MEMBER: 12,
});

export const RIDER_DAILY_QUEST_TARGET = 8;

export function pointsToKes(points) {
  const n = Math.max(0, Math.floor(Number(points) || 0));
  return Math.floor((n / POINTS_REDEEM_THRESHOLD) * POINTS_REDEEM_KES);
}

export function redeemBlocks(balance) {
  const bal = Math.max(0, Math.floor(Number(balance) || 0));
  const blocks = Math.floor(bal / POINTS_REDEEM_THRESHOLD);
  return {
    blocks,
    pointsSpent: blocks * POINTS_REDEEM_THRESHOLD,
    kesCredit: blocks * POINTS_REDEEM_KES,
    remainder: bal - blocks * POINTS_REDEEM_THRESHOLD,
  };
}

export function earnLabel(reason) {
  const map = {
    buyer_order_complete: `+${POINTS_EARN.BUYER_ORDER_COMPLETE} pts (order complete)`,
    seller_order_complete: `+${POINTS_EARN.SELLER_ORDER_COMPLETE} pts (sale complete)`,
    seller_badge_level_up: `+${POINTS_EARN.SELLER_BADGE_LEVEL_UP} pts (badge level-up)`,
    rider_delivery: `+${POINTS_EARN.RIDER_DELIVERY} pts (delivery)`,
    rider_daily_quest: `+${POINTS_EARN.RIDER_DAILY_QUEST} pts (daily quest 8/8)`,
    pamoja_join: `+${POINTS_EARN.PAMOJA_JOIN} pts (Pamoja join)`,
    pamoja_fill_leader: `+${POINTS_EARN.PAMOJA_FILL_LEADER} pts (Pamoja filled — leader)`,
    pamoja_fill_member: `+${POINTS_EARN.PAMOJA_FILL_MEMBER} pts (Pamoja filled)`,
  };
  return map[reason] || reason;
}
