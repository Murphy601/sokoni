#!/usr/bin/env node
/**
 * Seller hub fulfillment phases (awaiting_ship / shipped / received).
 * Run: node scripts/test-seller-order-phase.mjs
 */
import { sellerOrderFulfillment } from "../src/services/seller-onboard.js";

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

const paidBase = {
  customerPaymentStatus: "confirmed",
  escrowStatus: "held",
  status: "confirmed",
  shipmentStatus: "label_ready",
};

{
  const f = sellerOrderFulfillment(paidBase);
  assert("paid label → awaiting_ship", f.phase === "awaiting_ship");
  assert("needs Print label", f.needsDropOff === true);
  assert("not received", f.received === false);
}

{
  const f = sellerOrderFulfillment({
    ...paidBase,
    shipmentStatus: "in_transit",
    sellerDispatchedAt: Date.now(),
  });
  assert("DISPATCH → shipped", f.phase === "shipped");
  assert("no Print label after DISPATCH", f.needsDropOff === false);
}

{
  const f = sellerOrderFulfillment({
    ...paidBase,
    shipmentStatus: "delivered",
    status: "delivered",
    buyerConfirmedAt: Date.now(),
    sellerDispatchedAt: Date.now() - 1000,
  });
  assert("YES → received", f.phase === "received");
  assert("no Print label when received", f.needsDropOff === false);
  assert("label Received", f.phaseLabel === "Received");
}

{
  // Buyer confirmed but shipment field lagged — still Received, never Print label
  const f = sellerOrderFulfillment({
    ...paidBase,
    shipmentStatus: "label_ready",
    status: "confirmed",
    buyerConfirmedAt: Date.now(),
  });
  assert("buyerConfirmedAt alone → received", f.phase === "received");
  assert("buyerConfirmedAt clears Print label", f.needsDropOff === false);
}

{
  const f = sellerOrderFulfillment({
    ...paidBase,
    shipmentStatus: "label_ready",
    escrowStatus: "released",
    deliveredAt: Date.now(),
  });
  assert("escrow released → received", f.phase === "received");
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
