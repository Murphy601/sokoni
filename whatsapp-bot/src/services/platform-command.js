/**
 * Platform Manager — Admin Command Center aggregates.
 * Escrow holding tank, manual overrides, hub performance.
 */
import { listAllOrders, getOrder, updateOrderMeta, updateOrderStatus } from "./orders.js";
import { orderBuyerTotal, resolveSellerPayoutKes } from "./shipping-tiers.js";
import {
  getSettlementSummary,
  cancelSettlementPayout,
  reinstateSettlementPayout,
  scheduleSellerPayoutAfterDelivery,
} from "./settlements.js";
import { listLandmarkHubs } from "../lib/landmark-hubs.js";
import { config } from "../config.js";

function isHeldEscrow(order) {
  if (!order || order.kind === "cart_parent") return false;
  if (order.status === "cancelled") return false;
  const escrow = String(order.escrowStatus || "").toLowerCase();
  if (escrow === "refunded" || escrow === "released") return false;
  const paid =
    order.customerPaymentStatus === "confirmed" ||
    escrow === "held" ||
    Boolean(order.paidAt);
  if (!paid) return false;
  // Still in Sokoni custody until buyer YES / release / refund.
  if (order.disputeHold || order.escrowPaused) return true;
  if (escrow === "held" || escrow === "pending") return true;
  if (!order.buyerConfirmedAt && !order.deliveredAt && order.status !== "delivered") return true;
  return escrow === "held";
}

function orderHubLabel(order) {
  if (order?.dropOffHub) return String(order.dropOffHub).trim();
  if (order?.pickupPointName) return String(order.pickupPointName).trim();
  const town = String(order?.landmarkTown || "").trim();
  const spot = String(order?.landmarkSpot || "").trim();
  if (town && spot) return `${town} — ${spot}`;
  if (town) return town;
  if (spot) return spot;
  if (order?.deliveryMethod === "hub" || order?.deliveryType === "parcel_hub") {
    return "Unspecified hub";
  }
  if (order?.location) return String(order.location).trim().slice(0, 80);
  return "Direct / other";
}

function summarizeOrder(order) {
  const buyerTotal = orderBuyerTotal(order);
  const sellerNet = resolveSellerPayoutKes(order) || Math.round(buyerTotal * 0.9);
  return {
    orderId: order.id,
    productId: order.productId || null,
    productName: order.productName || null,
    buyerTotalKes: buyerTotal,
    sellerNetKes: sellerNet,
    platformFeeKes: Math.max(0, buyerTotal - sellerNet),
    escrowStatus: order.escrowStatus || null,
    status: order.status || null,
    shipmentStatus: order.shipmentStatus || null,
    disputeHold: Boolean(order.disputeHold),
    escrowPaused: Boolean(order.escrowPaused),
    refundPendingManual: Boolean(order.refundPendingManual),
    hub: orderHubLabel(order),
    supplierId: order.supplierId || null,
    customerName: order.customerName || null,
    paidAt: order.paidAt || null,
    createdAt: order.createdAt || null,
  };
}

/** Live view of KES held after buyer prepaid, awaiting confirmation / release. */
export function getEscrowHoldingTank({ limit = 80 } = {}) {
  const orders = listAllOrders().filter(isHeldEscrow);
  orders.sort((a, b) => (b.paidAt || b.createdAt || 0) - (a.paidAt || a.createdAt || 0));

  let heldBuyerKes = 0;
  let heldSellerNetKes = 0;
  let pausedCount = 0;
  let disputeCount = 0;
  for (const o of orders) {
    const row = summarizeOrder(o);
    heldBuyerKes += row.buyerTotalKes;
    heldSellerNetKes += row.sellerNetKes;
    if (row.escrowPaused) pausedCount += 1;
    if (row.disputeHold) disputeCount += 1;
  }

  const settlements = getSettlementSummary();
  const safeLimit = Math.min(Math.max(Number(limit) || 80, 1), 200);

  return {
    ok: true,
    till: {
      number: config.store?.mpesaTill || null,
      name: config.store?.mpesaTillName || null,
      note:
        "Logical escrow holding tank from paid orders (buyer totals). Till cash position is on Safaricom — reconcile manually until AccountBalance API is wired.",
    },
    totals: {
      heldOrders: orders.length,
      heldBuyerKes,
      heldSellerNetKes,
      platformFeeKes: Math.max(0, heldBuyerKes - heldSellerNetKes),
      pausedCount,
      disputeHoldCount: disputeCount,
      settlementOwedKes: settlements.totalOwedKes || 0,
      settlementScheduledKes: settlements.totalScheduledKes || 0,
      settlementDisbursingCount: settlements.disbursingCount || 0,
    },
    orders: orders.slice(0, safeLimit).map(summarizeOrder),
    generatedAt: Date.now(),
  };
}

/** Pause seller payout / mark escrow under manual review. */
export function pauseEscrowOrder(orderId, { reason = "", adminLabel = "admin" } = {}) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found", message: "Order not found." };
  cancelSettlementPayout(order.id, reason || "admin_pause");
  updateOrderMeta(order.id, {
    escrowPaused: true,
    disputeHold: true,
    escrowPauseReason: String(reason || "Manual pause").slice(0, 500),
    escrowPausedAt: Date.now(),
    escrowPausedBy: String(adminLabel).slice(0, 80),
  });
  return {
    ok: true,
    action: "pause",
    order: summarizeOrder(getOrder(order.id) || order),
    message: `Escrow paused for ${order.id}. Seller payout frozen until you refund or release.`,
  };
}

/** Mark for manual M-Pesa refund to buyer (Till transfer). */
export function refundEscrowOrder(orderId, { reason = "", adminLabel = "admin" } = {}) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found", message: "Order not found." };
  cancelSettlementPayout(order.id, reason || "admin_refund");
  updateOrderMeta(order.id, {
    escrowStatus: "refunded",
    escrowPaused: false,
    disputeHold: false,
    refundPendingManual: true,
    refundReason: String(reason || "Admin refund").slice(0, 500),
    refundedAt: Date.now(),
    refundedBy: String(adminLabel).slice(0, 80),
  });
  try {
    if (order.status !== "cancelled") {
      updateOrderStatus(order.id, "cancelled");
    }
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    action: "refund",
    order: summarizeOrder(getOrder(order.id) || order),
    message: `Marked ${order.id} for manual Till refund to buyer. Complete the M-Pesa reverse/transfer outside the bot.`,
  };
}

/** Release escrow toward seller payout (buyer confirmed / admin override). */
export function releaseEscrowOrder(orderId, { reason = "", adminLabel = "admin" } = {}) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found", message: "Order not found." };
  updateOrderMeta(order.id, {
    escrowStatus: "released",
    escrowPaused: false,
    disputeHold: false,
    buyerConfirmedAt: order.buyerConfirmedAt || Date.now(),
    escrowReleasedAt: Date.now(),
    escrowReleasedBy: String(adminLabel).slice(0, 80),
    escrowReleaseReason: String(reason || "Admin release").slice(0, 500),
  });
  reinstateSettlementPayout(order.id);
  const fresh = getOrder(order.id) || order;
  if (!fresh.isPaidOut) {
    scheduleSellerPayoutAfterDelivery(fresh);
  }
  return {
    ok: true,
    action: "release",
    order: summarizeOrder(getOrder(order.id) || order),
    message: `Escrow released for ${order.id}. Seller payout scheduled.`,
  };
}

/** Volume by drop-off hub / landmark from paid + scanned orders. */
export function getHubPerformanceStats({ days = 30 } = {}) {
  const windowMs = Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000;
  const since = Date.now() - windowMs;
  const catalog = listLandmarkHubs();
  const byHub = new Map();

  const bump = (label, order, { scanned = false } = {}) => {
    const key = label || "Direct / other";
    const row = byHub.get(key) || {
      hub: key,
      orders: 0,
      scanned: 0,
      buyerKes: 0,
      delivered: 0,
      awaitingShip: 0,
    };
    row.orders += 1;
    if (scanned) row.scanned += 1;
    row.buyerKes += orderBuyerTotal(order);
    if (order.status === "delivered" || order.shipmentStatus === "delivered" || order.buyerConfirmedAt) {
      row.delivered += 1;
    } else if (
      order.customerPaymentStatus === "confirmed" &&
      order.shipmentStatus !== "delivered"
    ) {
      row.awaitingShip += 1;
    }
    byHub.set(key, row);
  };

  for (const order of listAllOrders()) {
    if (order.kind === "cart_parent" || order.status === "cancelled") continue;
    const ts = order.paidAt || order.createdAt || 0;
    if (ts && ts < since) continue;
    const paid =
      order.customerPaymentStatus === "confirmed" ||
      order.escrowStatus === "held" ||
      order.escrowStatus === "released";
    if (!paid && !order.dropOffHub) continue;

    const scanned =
      Boolean(order.dropOffHub) ||
      (Array.isArray(order.shipmentHistory) &&
        order.shipmentHistory.some((h) => /scan|hub|drop/i.test(String(h?.note || h?.status || ""))));

    bump(orderHubLabel(order), order, { scanned });
  }

  const hubs = [...byHub.values()].sort((a, b) => b.orders - a.orders || b.buyerKes - a.buyerKes);

  return {
    ok: true,
    days: Math.max(1, Number(days) || 30),
    since,
    curatedHubOptions: catalog.options?.length || 0,
    hubs,
    topHub: hubs[0] || null,
    generatedAt: Date.now(),
  };
}

/** Combined dashboard payload for Admin Command Center. */
export async function getPlatformCommandDashboard() {
  const tank = getEscrowHoldingTank({ limit: 40 });
  const hubs = getHubPerformanceStats({ days: 30 });
  let openDisputes = { count: 0, disputes: [] };
  try {
    const { listAdminDisputes } = await import("./disputes.js");
    const listed = await listAdminDisputes({ status: "open", limit: 20 });
    if (!listed.error) openDisputes = listed;
  } catch {
    /* DB optional */
  }

  return {
    ok: true,
    escrow: tank,
    hubs,
    disputes: {
      openCount: openDisputes.count || openDisputes.disputes?.length || 0,
      disputes: (openDisputes.disputes || []).slice(0, 12),
    },
    links: {
      disputesUi: "/admin-disputes.html",
      supportUi: "/admin-support.html",
      listingsUi: "/admin-seller-listings.html",
      commandUi: "/admin-command.html",
    },
    generatedAt: Date.now(),
  };
}
