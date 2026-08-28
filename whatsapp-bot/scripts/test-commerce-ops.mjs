#!/usr/bin/env node
/**
 * Commerce ops smoke tests (checkout parse, AUP, PoP, dispatch parse).
 * Run: node scripts/test-commerce-ops.mjs
 */
import {
  parseCommerceIntent,
  checkAcceptableUsePolicy,
  verifyPaymentProof,
  threadIdFromPhone,
} from "../src/services/commerce-ops.js";

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

assert("thread id from phone digits", threadIdFromPhone("+254712345678").includes("254712345678"));

const cart = parseCommerceIntent(
  "Add 2 of those Sony headphones to my cart and send me the payment link."
);
assert("add-to-cart qty", cart.addToCart?.quantity === 2);
assert("add-to-cart query has sony", /sony|headphone/i.test(cart.addToCart?.query || ""));

const stock = parseCommerceIntent(
  "Update my inventory: I just received 20 units of Red Nike Air Max at KES 4500 each."
);
assert("stock qty 20", stock.stockUpdate?.quantity === 20);
assert("stock query nike", /nike|air max/i.test(stock.stockUpdate?.query || ""));

const dispatch = parseCommerceIntent("Dispatched Order #SKN-3011 via rider Kamau 0722123456.");
// parseCommerceIntent expects DISPATCH prefix — also test regex path
const dispatch2 = parseCommerceIntent("DISPATCH SKN-3011 via rider Kamau 0722123456");
assert("dispatch order id", dispatch2.dispatch?.orderId === "SKN-3011");
assert("dispatch rider phone", String(dispatch2.dispatch?.riderPhone || "").includes("722"));

const aup = checkAcceptableUsePolicy({ title: "Unregistered Medical Pills", description: "pharma" });
assert("AUP blocks medical pills", aup.allowed === false);

const aupOk = checkAcceptableUsePolicy({ title: "Red Nike Air Max sneakers", description: "size 42" });
assert("AUP allows sneakers", aupOk.allowed === true);

const pop = verifyPaymentProof({ orderId: "SKN-DOES-NOT-EXIST", code: "QA789XXABC" });
assert("PoP missing order", pop.ok === false);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nAll commerce-ops checks passed.");
