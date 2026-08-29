/**
 * Unified state machine for Sokoni order + boda custody transitions.
 * Rejects illegal jumps (e.g. cancel after IN_TRANSIT without return flow).
 *
 * Maps to existing Sokoni statuses (file orders + delivery_dispatches), not a greenfield ENUM rewrite.
 */

/** Order.status (orders.js) — allowed next states. */
export const ORDER_TRANSITIONS = {
  awaiting_payment: new Set(["payment_expired", "confirmed", "cancelled", "received"]),
  payment_expired: new Set(["awaiting_payment", "confirmed", "cancelled"]),
  received: new Set(["confirmed", "packed", "out_for_delivery", "cancelled"]),
  confirmed: new Set(["packed", "out_for_delivery", "delivered", "cancelled"]),
  packed: new Set(["out_for_delivery", "delivered", "cancelled"]),
  out_for_delivery: new Set(["delivered", "cancelled"]),
  delivered: new Set(["cancelled"]), // rare admin correction only
  cancelled: new Set([]),
};

/**
 * delivery_dispatches.status — custody pipeline at dispatch level.
 * DELIVERY_FAILED is the no-show / return path entry.
 */
export const DISPATCH_STATUS_TRANSITIONS = {
  REQUESTED: new Set(["ACCEPTED", "CANCELLED", "DISPUTED"]),
  ACCEPTED: new Set(["PICKED_UP", "OTP_SENT", "REQUESTED", "CANCELLED", "DISPUTED", "DELIVERY_FAILED"]),
  PICKED_UP: new Set(["OTP_SENT", "DELIVERED", "DISPUTED", "DELIVERY_FAILED"]),
  OTP_SENT: new Set(["DELIVERED", "OTP_LOCKED", "DISPUTED", "DELIVERY_FAILED"]),
  OTP_LOCKED: new Set(["OTP_SENT", "DISPUTED", "CANCELLED"]),
  DELIVERED: new Set(["DISPUTED"]),
  DELIVERY_FAILED: new Set(["CANCELLED", "DISPUTED", "REQUESTED"]),
  CANCELLED: new Set([]),
  DISPUTED: new Set(["DELIVERED", "CANCELLED", "ACCEPTED"]),
};

/** custody_status on delivery_dispatches */
export const CUSTODY_TRANSITIONS = {
  UNASSIGNED: new Set(["ASSIGNED", "UNASSIGNED"]),
  ASSIGNED: new Set(["IN_TRANSIT", "UNASSIGNED", "ASSIGNED"]),
  IN_TRANSIT: new Set(["DELIVERED", "RETURN_IN_TRANSIT", "IN_TRANSIT"]),
  DELIVERED: new Set(["DELIVERED"]),
  RETURN_IN_TRANSIT: new Set(["RETURNED", "RETURN_IN_TRANSIT"]),
  RETURNED: new Set(["RETURNED"]),
  DISPUTED: new Set(["RETURNED", "DELIVERED", "DISPUTED"]),
};

/**
 * After pickup (IN_TRANSIT / OTP_SENT), plain cancel is blocked unless force/admin/return path.
 */
export function canCancelOrder({ orderStatus, dispatchStatus, custodyStatus, force = false } = {}) {
  if (force) return { ok: true };
  const custody = String(custodyStatus || "").toUpperCase();
  const dStatus = String(dispatchStatus || "").toUpperCase();
  if (custody === "IN_TRANSIT" || custody === "RETURN_IN_TRANSIT") {
    return {
      ok: false,
      error: "illegal_transition",
      message:
        "Cannot cancel while the parcel is in rider custody. Use the no-show/return flow or Sokoni support.",
    };
  }
  if (["OTP_SENT", "PICKED_UP", "DELIVERED"].includes(dStatus) && custody !== "RETURNED") {
    return {
      ok: false,
      error: "illegal_transition",
      message: "Cannot cancel after pickup. Contact Sokoni support if the parcel must return.",
    };
  }
  if (orderStatus === "delivered") {
    return {
      ok: false,
      error: "illegal_transition",
      message: "Order already delivered — use dispute / partial refund paths, not cancel.",
    };
  }
  return { ok: true };
}

export function assertOrderTransition(fromStatus, toStatus, { force = false } = {}) {
  const from = String(fromStatus || "").toLowerCase();
  const to = String(toStatus || "").toLowerCase();
  if (!to || from === to) return { ok: true, unchanged: from === to };
  if (force) return { ok: true, forced: true };
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed) {
    // Unknown current status — allow (legacy rows) but flag
    return { ok: true, legacy: true };
  }
  if (!allowed.has(to)) {
    return {
      ok: false,
      error: "illegal_order_transition",
      message: `Illegal order status change: ${from} → ${to}`,
      from,
      to,
    };
  }
  // Extra: cancelling from out_for_delivery is only OK if not in rider IN_TRANSIT (caller passes force/canCancel)
  return { ok: true };
}

export function assertDispatchStatusTransition(fromStatus, toStatus, { force = false } = {}) {
  const from = String(fromStatus || "REQUESTED").toUpperCase();
  const to = String(toStatus || "").toUpperCase();
  if (!to || from === to) return { ok: true, unchanged: from === to };
  if (force) return { ok: true, forced: true };
  const allowed = DISPATCH_STATUS_TRANSITIONS[from];
  if (!allowed) return { ok: true, legacy: true };
  if (!allowed.has(to)) {
    return {
      ok: false,
      error: "illegal_dispatch_transition",
      message: `Illegal dispatch status: ${from} → ${to}`,
      from,
      to,
    };
  }
  return { ok: true };
}

export function assertCustodyTransition(fromCustody, toCustody, { force = false } = {}) {
  const from = String(fromCustody || "UNASSIGNED").toUpperCase() || "UNASSIGNED";
  const to = String(toCustody || "").toUpperCase();
  if (!to || from === to) return { ok: true, unchanged: from === to };
  if (force) return { ok: true, forced: true };
  const allowed = CUSTODY_TRANSITIONS[from];
  if (!allowed) return { ok: true, legacy: true };
  if (!allowed.has(to)) {
    return {
      ok: false,
      error: "illegal_custody_transition",
      message: `Illegal custody change: ${from} → ${to}`,
      from,
      to,
    };
  }
  return { ok: true };
}
