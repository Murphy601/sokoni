/**
 * Turns a platform fact into an enriched bus event and a heap snapshot.
 *
 * The snapshot is counts. Contact numbers never enter it, and a failure here
 * must not change the login, payment, or delivery that called it.
 */

import { AGENT_EVENTS } from "./event-bus.js";
import { publishEnriched } from "./enrich.js";
import { platformState } from "./platform-state.js";

function applyState(event, data) {
  const raw = data && typeof data === "object" ? data : {};
  if (event === AGENT_EVENTS.USER_SIGNED_IN) {
    platformState.touchUser(raw.senderUserId || raw.buyerUserId);
  } else if (event === AGENT_EVENTS.STK_PROMPTED) {
    platformState.trackEscrow(raw.orderId, {
      status: "prompted",
      amountKes: raw.amountKes,
      checkoutId: raw.checkoutId,
    });
  } else if (event === AGENT_EVENTS.PAYMENT_LOCKED) {
    platformState.trackEscrow(raw.orderId, { status: "held", amountKes: raw.amountKes });
    platformState.addVolume(raw.amountKes);
  } else if (event === AGENT_EVENTS.DISPUTE_OPENED) {
    platformState.noteDispute();
  } else if (event === AGENT_EVENTS.RIDER_ASSIGNED) {
    platformState.trackRider(raw.riderId, { orderId: raw.orderId, status: "assigned" });
  } else if (event === AGENT_EVENTS.OTP_VERIFIED) {
    platformState.trackRider(raw.riderId, { orderId: raw.orderId, status: "delivered" });
  }
}

export function announce(event, data = {}) {
  try {
    applyState(event, data);
  } catch (err) {
    console.warn("[fabric] state skipped:", err?.message || err);
  }
  return publishEnriched(event, data);
}
