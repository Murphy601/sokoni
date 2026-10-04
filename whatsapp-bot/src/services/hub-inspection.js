/**
 * Partner-hub inspection before a high-value item is dispatched.
 *
 * Built, and switched off. Set SOKONI_HUB_INSPECTION=1 before checkout offers
 * it. Until then the buyer never sees the choice.
 */

import { orderBuyerTotal } from "./shipping-tiers.js";

export const HUB_INSPECTION_MIN_KES = 3000;

export function hubInspectionLive() {
  return /^(1|true|on|yes)$/i.test(String(process.env.SOKONI_HUB_INSPECTION || ""));
}

export function hubInspectionOffer(order) {
  if (!hubInspectionLive()) return { offered: false, reason: "not_live" };
  const amount = Math.round(Number(orderBuyerTotal(order)) || 0);
  if (amount < HUB_INSPECTION_MIN_KES) return { offered: false, reason: "below_threshold" };
  return {
    offered: true,
    minKes: HUB_INSPECTION_MIN_KES,
    label: "Hub check before dispatch",
    detail:
      "A Sokoni partner hub compares the item with the listing before a rider collects it. Your M-Pesa is still held in escrow.",
  };
}
