/**
 * A short public feed of real order events.
 *
 * Names, phones, and order ids stay off it. The place is the delivery town
 * when the order has one, otherwise Kenya.
 */

import { orderBuyerTotal } from "./shipping-tiers.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function placeOf(order) {
  const town = String(order?.deliveryTown || order?.deliveryCounty || "").trim();
  return town ? town.slice(0, 32) : "Kenya";
}

function itemOf(order) {
  const name = String(order?.productName || order?.itemName || "an item").replace(/\s+/g, " ").trim();
  return (name || "an item").slice(0, 42);
}

function closedOut(order) {
  const status = String(order?.status || "").toUpperCase();
  const escrow = String(order?.escrowStatus || "").toUpperCase();
  return status === "REFUNDED" || status === "CANCELLED" || escrow === "REFUNDED" || escrow === "CANCELLED";
}

export function tickerItems(orders, now = Date.now()) {
  const items = [];
  for (const order of orders || []) {
    if (!order?.id || closedOut(order)) continue;
    const item = itemOf(order);
    const place = placeOf(order);
    const amount = Math.round(Number(orderBuyerTotal(order)) || 0);
    const releasedAt = Number(order.buyerConfirmedAt || order.releasedAt || 0);
    if (amount > 0 && (order.escrowStatus === "released" || order.isPaidOut) && releasedAt > 0) {
      items.push({
        at: releasedAt,
        text: `KES ${amount.toLocaleString("en-KE")} left escrow for ${item} · ${place}`,
      });
    }
    const dispatchedAt = Number(order.sellerDispatchedAt || 0);
    if (amount > 0 && dispatchedAt > 0) {
      items.push({
        at: dispatchedAt,
        text: `A rider was dispatched for ${item} · ${place}`,
      });
    }
  }
  return items
    .filter((row) => Number.isFinite(row.at) && now - row.at < WEEK_MS && now >= row.at)
    .sort((a, b) => b.at - a.at)
    .slice(0, 8)
    .map((row) => ({ at: row.at, text: row.text }));
}
