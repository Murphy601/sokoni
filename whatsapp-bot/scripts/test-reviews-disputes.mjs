#!/usr/bin/env node
/**
 * Unit checks for phase13 reviews + disputes helpers (no live DB).
 * Run: node scripts/test-reviews-disputes.mjs
 */
import { orderHasDisputeHold } from "../src/services/disputes.js";
import { cancelSettlementPayout, reinstateSettlementPayout } from "../src/services/settlements.js";

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

assert("dispute hold when flag set", orderHasDisputeHold({ disputeHold: true }));
assert("dispute hold when refunded", orderHasDisputeHold({ escrowStatus: "refunded" }));
assert("no hold on normal order", !orderHasDisputeHold({ escrowStatus: "held" }));

const cancelled = cancelSettlementPayout("__missing_order__", "test");
assert("cancel missing settlement returns null", cancelled == null);

const reinstated = reinstateSettlementPayout("__missing_order__");
assert("reinstate missing settlement returns null", reinstated == null);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
