/**
 * Rider live location — stored on order JSON; optional Socket.io broadcast.
 * Polling remains the reliable Path B fallback (track.html).
 */

import { getOrder, getOrderStore, updateOrderMeta } from "./orders.js";

/** @type {import('socket.io').Server | null} */
let io = null;

export function attachRiderSocket(server) {
  import("socket.io")
    .then(({ Server }) => {
      io = new Server(server, {
        path: "/socket.io",
        cors: { origin: true, credentials: false },
      });
      io.on("connection", (socket) => {
        socket.on("order:subscribe", (orderId) => {
          const id = String(orderId || "").trim();
          if (id) socket.join(`order-${id}`);
        });
      });
      console.log("[rider] Socket.io attached at /socket.io");
    })
    .catch(() => {
      console.warn("[rider] socket.io not installed — using HTTP poll only");
    });
}

export function getRiderLocation(orderId) {
  const order = getOrder(orderId);
  if (!order) return null;
  if (order.riderLat == null || order.riderLng == null) {
    return {
      orderId: order.id,
      hasRider: false,
      shipmentStatus: order.shipmentStatus || null,
      buyerLat: order.buyerLat ?? null,
      buyerLng: order.buyerLng ?? null,
    };
  }
  return {
    orderId: order.id,
    hasRider: true,
    lat: Number(order.riderLat),
    lng: Number(order.riderLng),
    heading: order.riderHeading != null ? Number(order.riderHeading) : null,
    speed: order.riderSpeed != null ? Number(order.riderSpeed) : null,
    updatedAt: order.riderUpdatedAt || null,
    shipmentStatus: order.shipmentStatus || null,
    buyerLat: order.buyerLat ?? null,
    buyerLng: order.buyerLng ?? null,
  };
}

export function setRiderLocation(orderId, { lat, lng, heading, speed } = {}) {
  const order = getOrder(orderId);
  if (!order) return { ok: false, error: "order_not_found" };
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    return { ok: false, error: "invalid_coordinates" };
  }
  const updatedAt = new Date().toISOString();
  updateOrderMeta(orderId, {
    riderLat: la,
    riderLng: ln,
    riderHeading: heading != null ? Number(heading) : order.riderHeading ?? null,
    riderSpeed: speed != null ? Number(speed) : order.riderSpeed ?? null,
    riderUpdatedAt: updatedAt,
  });
  const payload = getRiderLocation(orderId);
  if (io) {
    io.to(`order-${order.id}`).emit("rider:location-update", payload);
  }
  return { ok: true, location: payload };
}

/** Aggregate successful order pins for a vendor heatmap. */
export function vendorOrderLocations(vendorKey) {
  const key = String(vendorKey || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  if (!key) return { points: [], stats: { totalMapped: 0, topLocation: null, topSharePct: 0 } };

  const store = getOrderStore();
  const points = [];
  const areaCounts = new Map();

  for (const o of Object.values(store.orders || {})) {
    const handle = String(o.shopHandle || "")
      .trim()
      .toLowerCase()
      .replace(/^@/, "");
    const supplier = String(o.supplierId || "").trim().toLowerCase();
    if (handle !== key && supplier !== key) continue;
    if (
      o.customerPaymentStatus !== "confirmed" &&
      o.escrowStatus !== "held" &&
      o.escrowStatus !== "released"
    ) {
      continue;
    }
    if (o.buyerLat == null || o.buyerLng == null) continue;
    points.push({
      lat: Number(o.buyerLat),
      lng: Number(o.buyerLng),
      orderId: o.id,
      county: o.deliveryCounty || null,
      town: o.deliveryTown || null,
    });
    const label = o.deliveryTown || o.deliveryCounty || "Pinned";
    areaCounts.set(label, (areaCounts.get(label) || 0) + 1);
  }

  let topLocation = null;
  let topCount = 0;
  for (const [label, count] of areaCounts) {
    if (count > topCount) {
      topLocation = label;
      topCount = count;
    }
  }

  return {
    points,
    stats: {
      totalMapped: points.length,
      topLocation,
      topSharePct: points.length ? Math.round((topCount / points.length) * 100) : 0,
    },
  };
}
