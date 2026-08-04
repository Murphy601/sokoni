/**
 * Phase 6 — Shipment status, hub scans, and public SK-#### tracking.
 */
import { getOrder, updateOrderMeta, updateOrderStatus, statusLabel } from "./orders.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import { formatFulfillmentLine } from "./fulfillment.js";
import { isDbEnabled } from "../db/pool.js";

export const SHIPMENT_STATUSES = [
  "pending",
  "label_ready",
  "dropped_off",
  "in_transit",
  "at_pickup_point",
  "delivered",
  "failed",
  "returned",
];

/** Customer-facing shipment steps (after payment). */
export const SHIPMENT_STEPS = ["label_ready", "dropped_off", "in_transit", "at_pickup_point", "delivered"];

const STATUS_LABELS = {
  pending: "Awaiting label",
  label_ready: "Prepaid label ready",
  dropped_off: "Dropped at hub",
  in_transit: "In transit",
  at_pickup_point: "At pickup point",
  delivered: "Delivered",
  failed: "Delivery failed",
  returned: "Returned to sender",
};

const NEXT_STATUS = {
  pending: "label_ready",
  label_ready: "dropped_off",
  dropped_off: "in_transit",
  in_transit: "at_pickup_point",
  at_pickup_point: "delivered",
};

export function shipmentStatusLabel(status) {
  return STATUS_LABELS[status] || status || "Unknown";
}

export function getEffectiveShipmentStatus(order) {
  if (!order) return "pending";
  return order.shipmentStatus || "pending";
}

function appendHistory(order, entry) {
  const history = Array.isArray(order.shipmentHistory) ? [...order.shipmentHistory] : [];
  history.push(entry);
  if (history.length > 30) history.splice(0, history.length - 30);
  return history;
}

/** Map shipment progress to order.status where helpful. */
function syncOrderStatus(orderId, shipmentStatus) {
  const order = getOrder(orderId);
  if (!order) return;

  if (shipmentStatus === "in_transit" && ["confirmed", "packed"].includes(order.status)) {
    updateOrderStatus(orderId, "out_for_delivery");
  }
  if (shipmentStatus === "at_pickup_point" && order.status !== "delivered") {
    updateOrderStatus(orderId, "out_for_delivery");
  }
  if (shipmentStatus === "delivered" && order.status !== "delivered") {
    updateOrderStatus(orderId, "delivered");
    import("./escrow-automation.js")
      .then(({ onOrderDelivered }) => onOrderDelivered(getOrder(orderId) || order))
      .catch((err) => console.warn("[shipments] escrow release failed:", err.message));
  }
}

async function mirrorShipmentToDb(order) {
  if (!isDbEnabled() || !order?.id) return;
  try {
    const { upsertShipmentFromOrder } = await import("../db/repositories/shipments.js");
    await upsertShipmentFromOrder(order);
  } catch (err) {
    console.warn("[shipments] DB mirror failed:", err.message);
  }
}

/**
 * Advance shipment status with audit history.
 * @param {string} orderId
 * @param {string} nextStatus
 * @param {object} meta
 */
export function advanceShipmentStatus(orderId, nextStatus, meta = {}) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found" };

  const status = String(nextStatus || "").trim();
  if (!SHIPMENT_STATUSES.includes(status)) {
    return { error: "invalid_status", valid: SHIPMENT_STATUSES };
  }

  const prevStatus = getEffectiveShipmentStatus(order);

  const entry = {
    status,
    at: Date.now(),
    hub: meta.hub || meta.hubName || null,
    courier: meta.courier || meta.courierName || order.courierName || null,
    note: meta.note || null,
    actor: meta.actor || "system",
  };

  const patch = {
    shipmentStatus: status,
    shipmentHistory: appendHistory(order, entry),
    shipmentUpdatedAt: Date.now(),
  };

  if (meta.courier || meta.courierName) patch.courierName = meta.courier || meta.courierName;
  if (meta.trackingRef || meta.courierTrackingRef) {
    patch.courierTrackingRef = meta.trackingRef || meta.courierTrackingRef;
  }
  if (meta.hub || meta.hubName) patch.dropOffHub = meta.hub || meta.hubName;
  if (meta.riderName) patch.riderName = meta.riderName;
  if (meta.riderPhone) patch.riderPhone = meta.riderPhone;
  if (meta.etaNote) patch.transitEta = meta.etaNote;
  if (status === "dropped_off") patch.droppedOffAt = Date.now();
  if (status === "in_transit") patch.inTransitAt = Date.now();
  if (status === "delivered") patch.shipmentDeliveredAt = Date.now();

  updateOrderMeta(orderId, patch);
  syncOrderStatus(orderId, status);

  const updated = getOrder(orderId);
  mirrorShipmentToDb(updated).catch(() => {});

  if (!meta.skipBuyerNotify && !meta.skipNotify) {
    import("./order-notifications.js")
      .then(({ notifyShipmentStatusChange }) => notifyShipmentStatusChange(updated, { prevStatus, meta }))
      .catch((err) => console.warn("[shipments] notify failed:", err.message));
  }

  return { order: updated, status };
}

/** Auto-advance one step (hub scan default). */
export function scanShipmentAtHub(orderId, meta = {}) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found" };

  const current = getEffectiveShipmentStatus(order);
  const forced = meta.forceStatus ? String(meta.forceStatus) : null;
  const next = forced || NEXT_STATUS[current];

  if (!next) {
    return { error: "no_next_status", current, order };
  }
  if (forced && !SHIPMENT_STATUSES.includes(forced)) {
    return { error: "invalid_status" };
  }

  return advanceShipmentStatus(orderId, next, { ...meta, actor: meta.actor || "hub_scan" });
}

export function assignCourier(orderId, { courier = "manual", trackingRef = "", note = "" } = {}) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found" };

  updateOrderMeta(orderId, {
    courierName: courier,
    courierTrackingRef: trackingRef || order.courierTrackingRef || null,
    shipmentHistory: appendHistory(order, {
      status: getEffectiveShipmentStatus(order),
      at: Date.now(),
      courier,
      trackingRef: trackingRef || null,
      note: note || "Courier assigned",
      actor: "admin",
    }),
  });

  const updated = getOrder(orderId);
  mirrorShipmentToDb(updated).catch(() => {});
  return { order: updated };
}

export function buildShipmentTimeline(order) {
  const current = getEffectiveShipmentStatus(order);
  if (current === "failed" || current === "returned") {
    return [{ status: current, label: shipmentStatusLabel(current), active: true, done: false }];
  }

  const idx = SHIPMENT_STEPS.indexOf(current);
  const safeIdx = idx >= 0 ? idx : 0;

  return SHIPMENT_STEPS.map((step, i) => ({
    status: step,
    label: shipmentStatusLabel(step),
    done: i < safeIdx || (step === "delivered" && current === "delivered"),
    active: i === safeIdx,
  }));
}

export function renderShipmentTimelineText(order) {
  const steps = buildShipmentTimeline(order);
  return steps
    .map((s) => {
      const mark = s.done ? "✅" : s.active ? "🔵" : "⚪";
      return `${mark} ${s.label}`;
    })
    .join("\n");
}

/** Sanitized payload for public web + API tracking. */
export function buildPublicTrackingPayload(order) {
  if (!order) return null;

  const shipmentSteps = buildShipmentTimeline(order);
  const orderStatus = order.status;

  return {
    orderId: order.id,
    productName: order.productName,
    totalKes: orderBuyerTotal(order),
    paid: order.customerPaymentStatus === "confirmed",
    paymentLine: order.customerPaymentStatus === "confirmed" ? "Paid — escrow held" : "Awaiting payment",
    orderStatus,
    orderStatusLabel: statusLabel(orderStatus),
    shipmentStatus: getEffectiveShipmentStatus(order),
    shipmentStatusLabel: shipmentStatusLabel(getEffectiveShipmentStatus(order)),
    shipmentTimeline: shipmentSteps,
    fulfillment: formatFulfillmentLine(order),
    courier: order.courierName || null,
    trackingRef: order.courierTrackingRef || order.id,
    dropOffHub: order.dropOffHub || null,
    labelUrl: order.labelUrl || null,
    riderName: order.riderName || null,
    riderPhone: order.riderPhone ? maskPhone(order.riderPhone) : null,
    etaNote: order.transitEta || null,
    updatedAt: order.shipmentUpdatedAt || order.updatedAt || order.createdAt,
    history: (order.shipmentHistory || []).slice(-8).map((h) => ({
      status: h.status,
      label: shipmentStatusLabel(h.status),
      at: h.at,
      hub: h.hub || null,
      note: h.note || null,
    })),
  };
}

function maskPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length < 6) return "—";
  return `***${d.slice(-4)}`;
}

export function trackingMeta() {
  return {
    phase: 6,
    couriers: ["manual", "fargo", "pickup_mtaani", "sendy", "g4s"],
    shipmentStatuses: SHIPMENT_STATUSES,
    publicEndpoint: "/api/tracking/:orderId",
    scanCommand: "#scan SK-#### [dropped_off|in_transit|delivered] hub:Name",
  };
}
