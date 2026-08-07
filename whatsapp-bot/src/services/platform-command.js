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
  processDuePayouts,
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

function orderDeliveryState(order) {
  const shipmentStatus = String(order?.shipmentStatus || "pending").toLowerCase();
  const status = String(order?.status || "").toLowerCase();
  const delivered = Boolean(
    status === "delivered" ||
      shipmentStatus === "delivered" ||
      order?.buyerConfirmedAt ||
      order?.shipmentDeliveredAt ||
      order?.deliveredAt
  );
  const inTransit = Boolean(
    !delivered &&
      (order?.sellerDispatchedAt ||
        order?.inTransitAt ||
        ["dropped_off", "in_transit", "at_pickup_point", "out_for_delivery"].includes(shipmentStatus) ||
        status === "out_for_delivery")
  );
  const buyerConfirmed = Boolean(order?.buyerConfirmedAt);
  let deliveryLabel = "Not delivered";
  let releaseHint = "Wait for delivery before releasing";
  if (delivered && buyerConfirmed) {
    deliveryLabel = "Delivered · buyer confirmed";
    releaseHint = "Safe to release";
  } else if (delivered) {
    deliveryLabel = "Delivered";
    releaseHint = "Delivered — release when ready";
  } else if (inTransit) {
    deliveryLabel = "In transit";
    releaseHint = "Not delivered yet";
  }
  return {
    delivered,
    inTransit,
    buyerConfirmed,
    deliveryLabel,
    releaseHint,
    shipmentStatus: shipmentStatus || "pending",
  };
}

function summarizeOrder(order) {
  const buyerTotal = orderBuyerTotal(order);
  const sellerNet = resolveSellerPayoutKes(order) || Math.round(buyerTotal * 0.9);
  const delivery = orderDeliveryState(order);
  return {
    orderId: order.id,
    productId: order.productId || null,
    productName: order.productName || null,
    buyerTotalKes: buyerTotal,
    sellerNetKes: sellerNet,
    platformFeeKes: Math.max(0, buyerTotal - sellerNet),
    escrowStatus: order.escrowStatus || null,
    status: order.status || null,
    shipmentStatus: delivery.shipmentStatus,
    delivered: delivery.delivered,
    inTransit: delivery.inTransit,
    buyerConfirmed: delivery.buyerConfirmed,
    deliveryLabel: delivery.deliveryLabel,
    releaseHint: delivery.releaseHint,
    disputeHold: Boolean(order.disputeHold),
    escrowPaused: Boolean(order.escrowPaused),
    refundPendingManual: Boolean(order.refundPendingManual),
    hub: orderHubLabel(order),
    supplierId: order.supplierId || null,
    customerName: order.customerName || null,
    paidAt: order.paidAt || null,
    createdAt: order.createdAt || null,
    deliveredAt: order.deliveredAt || order.shipmentDeliveredAt || order.buyerConfirmedAt || null,
  };
}

/** Live view of KES held after buyer prepaid, awaiting confirmation / release. */
export function getEscrowHoldingTank({ limit = 80 } = {}) {
  const orders = listAllOrders().filter(isHeldEscrow);
  const rows = orders.map(summarizeOrder);
  // Delivered first (ready to consider release), then newest paid.
  rows.sort((a, b) => {
    if (Boolean(a.delivered) !== Boolean(b.delivered)) return a.delivered ? -1 : 1;
    return (b.paidAt || b.createdAt || 0) - (a.paidAt || a.createdAt || 0);
  });

  let heldBuyerKes = 0;
  let heldSellerNetKes = 0;
  let pausedCount = 0;
  let disputeCount = 0;
  let deliveredCount = 0;
  let notDeliveredCount = 0;
  for (const row of rows) {
    heldBuyerKes += row.buyerTotalKes;
    heldSellerNetKes += row.sellerNetKes;
    if (row.escrowPaused) pausedCount += 1;
    if (row.disputeHold) disputeCount += 1;
    if (row.delivered) deliveredCount += 1;
    else notDeliveredCount += 1;
  }

  const settlements = getSettlementSummary();
  const safeLimit = Math.min(Math.max(Number(limit) || 80, 1), 200);

  return {
    ok: true,
    till: {
      number: config.store?.mpesaTill || null,
      name: config.store?.mpesaTillName || null,
      note:
        "Logical escrow holding tank from paid orders (buyer totals). Till cash position is on Safaricom — reconcile manually until AccountBalance API is wired. Prefer Release only when status is Delivered.",
    },
    totals: {
      heldOrders: rows.length,
      heldBuyerKes,
      heldSellerNetKes,
      platformFeeKes: Math.max(0, heldBuyerKes - heldSellerNetKes),
      pausedCount,
      disputeHoldCount: disputeCount,
      deliveredCount,
      notDeliveredCount,
      settlementOwedKes: settlements.totalOwedKes || 0,
      settlementScheduledKes: settlements.totalScheduledKes || 0,
      settlementDisbursingCount: settlements.disbursingCount || 0,
    },
    orders: rows.slice(0, safeLimit),
    generatedAt: Date.now(),
  };
}

/**
 * Keep buyer / seller / admin surfaces in sync after escrow overrides.
 * Fire-and-forget — never blocks the admin API response.
 */
async function fanOutEscrowSync(orderId, action, { reason = "", payoutAmountKes = null } = {}) {
  try {
    const order = getOrder(orderId);
    if (!order) return;

    const { notifyOrderParties, notifyAdminEvent, resolveAdminTakeOver } = await import(
      "./communication-hub.js"
    );

    const reasonBit = reason ? `\nReason: ${String(reason).slice(0, 160)}` : "";
    const trackUrl = `${config.publicSiteUrl}/track.html?order=${encodeURIComponent(order.id)}`;
    let buyerMessage = null;
    let sellerMessage = null;
    let eventType = null;

    if (action === "release") {
      const amt = payoutAmountKes ?? order.sellerPayoutKes ?? order.sellerNetKes;
      buyerMessage =
        `✅ *Order ${order.id} completed*\n\n` +
        `Sokoni released escrow — your order is complete.\n` +
        `Track: ${trackUrl}\n\n` +
        `How was it? Reply *1*–*5* when prompted.`;
      sellerMessage =
        `💰 *Escrow released — ${order.id}*\n\n` +
        (amt != null
          ? `KES ${Number(amt).toLocaleString()} is now on your *available* balance.\n`
          : `Payout is now on your available balance.\n`) +
        `Open Seller Hub → Payouts to withdraw, or WhatsApp *balance*.`;
      eventType = "ESCROW_RELEASED";
    } else if (action === "pause") {
      buyerMessage =
        `⏸️ *Order ${order.id} paused*\n\n` +
        `Sokoni paused escrow while we review.` +
        `${reasonBit}\n` +
        `We'll update you shortly. Reply HELP ${order.id} if you need support.`;
      sellerMessage =
        `⏸️ *Escrow paused — ${order.id}*\n\n` +
        `Seller payout is frozen until Sokoni refunds or releases.` +
        reasonBit;
      eventType = "ESCROW_PAUSED";
    } else if (action === "refund") {
      buyerMessage =
        `↩️ *Refund started — ${order.id}*\n\n` +
        `Sokoni will refund your M-Pesa payment to the buyer Till/phone.` +
        `${reasonBit}\n` +
        `Track: ${trackUrl}`;
      sellerMessage =
        `↩️ *Order refunded — ${order.id}*\n\n` +
        `Escrow returns to the buyer — this sale will not pay out.` +
        reasonBit;
      eventType = "ESCROW_REFUNDED";
    }

    await notifyOrderParties(order, { buyerMessage, sellerMessage });
    if (eventType) {
      void notifyAdminEvent(eventType, {
        orderId: order.id,
        details: reason || action,
        silent: true,
      });
    }

    if (action === "release" || action === "refund") {
      try {
        const live = getOrder(order.id) || order;
        if (live.adminTakeOver || live.adminFlagged || live.supportStatus) {
          await resolveAdminTakeOver(order.id, {
            note: `admin_${action}`,
            notifyParties: false,
          });
        }
        // Admin override wins over any open-dispute hold that takeover helper might restore.
        if (action === "release") {
          updateOrderMeta(order.id, {
            disputeHold: false,
            escrowPaused: false,
            escrowStatus: "released",
          });
        } else {
          updateOrderMeta(order.id, {
            disputeHold: false,
            escrowStatus: "refunded",
          });
        }
      } catch (err) {
        console.warn("[platform-command] resolve takeover failed:", err?.message || err);
      }
    }

    if (action === "release") {
      try {
        const { ensureOrderSellerUserId, creditSellerSaleReview } = await import(
          "../db/repositories/social.js"
        );
        await ensureOrderSellerUserId(order);
        await creditSellerSaleReview(getOrder(order.id) || order);
      } catch (err) {
        console.warn("[platform-command] social credit skipped:", err?.message || err);
      }
    }

    if (order.parentOrderId || order.kind === "cart_child") {
      try {
        const { refreshCartParentStatus } = await import("./cart-orders.js");
        refreshCartParentStatus(order.parentOrderId || order.id.replace(/-\d+$/, ""));
      } catch (err) {
        console.warn("[platform-command] cart parent rollup skipped:", err?.message || err);
      }
    }
  } catch (err) {
    console.warn("[platform-command] fan-out sync failed:", err?.message || err);
  }
}

/** Align order/shipment status with released escrow without re-running onOrderDelivered (+3bd hold). */
function markOrderCompleteOnRelease(order) {
  if (!order?.id) return;
  const now = Date.now();
  try {
    if (order.status !== "delivered" && order.status !== "cancelled") {
      updateOrderStatus(order.id, "delivered");
    }
  } catch {
    /* ignore */
  }
  updateOrderMeta(order.id, {
    shipmentStatus: "delivered",
    deliveredAt: order.deliveredAt || now,
    shipmentDeliveredAt: order.shipmentDeliveredAt || now,
  });
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
  void fanOutEscrowSync(order.id, "pause", { reason });
  return {
    ok: true,
    action: "pause",
    order: summarizeOrder(getOrder(order.id) || order),
    message: `Escrow paused for ${order.id}. Seller payout frozen until you refund or release. Buyer & seller notified.`,
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
  void fanOutEscrowSync(order.id, "refund", { reason });
  return {
    ok: true,
    action: "refund",
    order: summarizeOrder(getOrder(order.id) || order),
    message: `Marked ${order.id} for manual Till refund to buyer. Buyer & seller notified — complete the M-Pesa reverse/transfer outside the bot.`,
  };
}

/** Release escrow toward seller payout (buyer confirmed / admin override). */
export function releaseEscrowOrder(orderId, { reason = "", adminLabel = "admin" } = {}) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found", message: "Order not found." };
  if (order.isPaidOut) {
    return {
      ok: true,
      action: "release",
      order: summarizeOrder(order),
      message: `${order.id} already paid out to seller.`,
    };
  }

  const buyerTotal = orderBuyerTotal(order);
  const netAmount =
    resolveSellerPayoutKes(order) ||
    Math.round(Number(order.sellerNetKes ?? order.sourcePriceKes) || 0) ||
    Math.round(buyerTotal * 0.9);
  // Admin Release is an override — make payout eligible immediately so Seller Hub
  // "Available" updates (settlements only count status=owed toward withdrawable).
  const eligibleAt = Date.now();

  updateOrderMeta(order.id, {
    escrowStatus: "released",
    escrowPaused: false,
    disputeHold: false,
    buyerConfirmedAt: order.buyerConfirmedAt || Date.now(),
    escrowReleasedAt: Date.now(),
    escrowReleasedBy: String(adminLabel).slice(0, 80),
    escrowReleaseReason: String(reason || "Admin release").slice(0, 500),
    payoutEligibleAt: eligibleAt,
    payoutStatus: "scheduled",
    sellerNetKes: order.sellerNetKes ?? netAmount,
    sellerPayoutKes: order.sellerPayoutKes ?? netAmount,
    sourcePriceKes: order.sourcePriceKes ?? netAmount,
  });

  // Align buyer track + seller order lists without re-entering onOrderDelivered
  // (that path would reset eligibility to +3 business days).
  markOrderCompleteOnRelease(getOrder(order.id) || order);
  // Re-assert immediate eligibility after status/meta patches.
  updateOrderMeta(order.id, {
    payoutEligibleAt: eligibleAt,
    payoutStatus: "scheduled",
    escrowStatus: "released",
  });

  reinstateSettlementPayout(order.id, { payoutEligibleAt: eligibleAt });
  const fresh = getOrder(order.id) || order;
  const scheduled = scheduleSellerPayoutAfterDelivery(
    {
      ...fresh,
      sellerNetKes: netAmount,
      sellerPayoutKes: fresh.sellerPayoutKes || netAmount,
      sourcePriceKes: fresh.sourcePriceKes || netAmount,
      payoutEligibleAt: eligibleAt,
    },
    { refreshEligibleAt: true }
  );
  const promoted = processDuePayouts();

  void fanOutEscrowSync(order.id, "release", {
    reason,
    payoutAmountKes: scheduled?.payoutAmountKes ?? netAmount,
  });

  return {
    ok: true,
    action: "release",
    order: summarizeOrder(getOrder(order.id) || order),
    payout: scheduled
      ? {
          orderId: scheduled.orderId,
          payoutAmountKes: scheduled.payoutAmountKes,
          status: scheduled.status,
          payoutEligibleAt: scheduled.payoutEligibleAt,
        }
      : null,
    promoted,
    message: scheduled
      ? `Escrow released for ${order.id}. Seller payout ${formatKesShort(scheduled.payoutAmountKes)} is now on their available balance. Buyer & seller notified on WhatsApp.`
      : `Escrow released for ${order.id}, but no seller payout line was created — check supplierId / seller net on the order.`,
  };
}

function formatKesShort(n) {
  return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
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

function orderPlatformFeeKes(order) {
  const stored = Math.round(Number(order?.platformFeeKes));
  if (Number.isFinite(stored) && stored >= 0) return stored;
  const buyerTotal = orderBuyerTotal(order);
  const sellerNet = resolveSellerPayoutKes(order) || 0;
  return Math.max(0, Math.round(buyerTotal - sellerNet));
}

function orderTransactionFeeKes(order) {
  const stored = Math.round(Number(order?.transactionFeeKes));
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
}

function commissionFeeStatus(order) {
  const escrow = String(order?.escrowStatus || "").toLowerCase();
  if (escrow === "refunded" || order?.refundPendingManual || order?.status === "cancelled") {
    const wasPaid =
      order?.customerPaymentStatus === "confirmed" ||
      Boolean(order?.paidAt) ||
      Boolean(order?.refundedAt);
    return wasPaid ? "refunded" : null;
  }
  if (escrow === "released") return "earned";
  if (isHeldEscrow(order)) return "held";
  return null;
}

function commissionEarnedAt(order) {
  return (
    order?.escrowReleasedAt ||
    order?.buyerConfirmedAt ||
    order?.deliveredAt ||
    order?.shipmentDeliveredAt ||
    order?.paidAt ||
    order?.createdAt ||
    null
  );
}

function summarizeCommissionRow(order) {
  const feeStatus = commissionFeeStatus(order);
  const buyerTotal = orderBuyerTotal(order);
  const sellerPayout = resolveSellerPayoutKes(order) || 0;
  return {
    orderId: order.id,
    productName: order.productName || null,
    supplierId: order.supplierId || null,
    hub: orderHubLabel(order),
    buyerTotalKes: buyerTotal,
    sellerPayoutKes: sellerPayout,
    platformFeeKes: orderPlatformFeeKes(order),
    transactionFeeKes: orderTransactionFeeKes(order),
    escrowStatus: order.escrowStatus || null,
    feeStatus,
    paidAt: order.paidAt || null,
    earnedAt: feeStatus === "earned" ? commissionEarnedAt(order) : null,
  };
}

/**
 * System commission / Sokoni fee ledger.
 * Earned = escrow released (Sokoni keeps platformFeeKes).
 * Held = paid, still in tank. Refunded = fee never kept.
 */
export function getPlatformCommissions({ days = 30, limit = 80, status = "all" } = {}) {
  const windowDays = Math.max(1, Number(days) || 30);
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const since = Date.now() - windowMs;
  const statusFilter = String(status || "all").toLowerCase();
  const safeLimit = Math.min(Math.max(Number(limit) || 80, 1), 200);

  const totals = {
    earnedPlatformFeeKes: 0,
    earnedTransactionFeeKes: 0,
    heldPlatformFeeKes: 0,
    heldTransactionFeeKes: 0,
    refundedPlatformFeeKes: 0,
    earnedCount: 0,
    heldCount: 0,
    refundedCount: 0,
    earnedAllTimeKes: 0,
    earnedAllTimeCount: 0,
  };

  const rows = [];

  for (const order of listAllOrders()) {
    if (!order || order.kind === "cart_parent") continue;
    const feeStatus = commissionFeeStatus(order);
    if (!feeStatus) continue;

    const platformFeeKes = orderPlatformFeeKes(order);
    const transactionFeeKes = orderTransactionFeeKes(order);
    const earnedAt = commissionEarnedAt(order);
    const paidAt = order.paidAt || order.createdAt || 0;

    if (feeStatus === "earned") {
      totals.earnedAllTimeKes += platformFeeKes;
      totals.earnedAllTimeCount += 1;
      if (!earnedAt || earnedAt >= since) {
        totals.earnedPlatformFeeKes += platformFeeKes;
        totals.earnedTransactionFeeKes += transactionFeeKes;
        totals.earnedCount += 1;
        if (statusFilter === "all" || statusFilter === "earned") {
          rows.push(summarizeCommissionRow(order));
        }
      }
      continue;
    }

    if (feeStatus === "held") {
      totals.heldPlatformFeeKes += platformFeeKes;
      totals.heldTransactionFeeKes += transactionFeeKes;
      totals.heldCount += 1;
      if (statusFilter === "all" || statusFilter === "held") {
        rows.push(summarizeCommissionRow(order));
      }
      continue;
    }

    if (feeStatus === "refunded") {
      if (paidAt && paidAt < since && !order.refundedAt) continue;
      const refundTs = order.refundedAt || paidAt || 0;
      if (refundTs && refundTs < since) continue;
      totals.refundedPlatformFeeKes += platformFeeKes;
      totals.refundedCount += 1;
      if (statusFilter === "all" || statusFilter === "refunded") {
        rows.push(summarizeCommissionRow(order));
      }
    }
  }

  rows.sort((a, b) => {
    const rank = { earned: 0, held: 1, refunded: 2 };
    const ra = rank[a.feeStatus] ?? 9;
    const rb = rank[b.feeStatus] ?? 9;
    if (ra !== rb) return ra - rb;
    const ta = a.earnedAt || a.paidAt || 0;
    const tb = b.earnedAt || b.paidAt || 0;
    return tb - ta;
  });

  return {
    ok: true,
    days: windowDays,
    since,
    status: statusFilter,
    note:
      "Sokoni commission is 10% (platformFeeKes) kept when escrow is released. Held fees are still in the till until Release. Refunded fees are not earned.",
    totals,
    fees: rows.slice(0, safeLimit),
    generatedAt: Date.now(),
  };
}

/** Combined dashboard payload for Admin Command Center. */
export async function getPlatformCommandDashboard() {
  const tank = getEscrowHoldingTank({ limit: 40 });
  const hubs = getHubPerformanceStats({ days: 30 });
  const commissions = getPlatformCommissions({ days: 30, limit: 40, status: "all" });
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
    commissions,
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
