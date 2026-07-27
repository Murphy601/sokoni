#!/usr/bin/env node
/** Smoke test: seller fee engine + AI shipping suggestion (no free shipping). */
import {
  applyAiShippingSuggestion,
  computeFeeBreakdown,
  computeProductTotals,
  orderBuyerTotal,
  formatProductListPrice,
  inferWeightClass,
  MIN_SHIPPING_KES,
  validateShippingKes,
} from "../src/services/shipping-tiers.js";

let failed = 0;

function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

const yogurt = applyAiShippingSuggestion({ name: "Fresh yogurt cup" });
assert("yogurt weight class small", yogurt.estimatedWeightClass === "small");
assert("yogurt shipping min 150", yogurt.shippingKes === 150);

const fees = computeFeeBreakdown(300, 150);
assert("buyer pays 450", fees.buyerTotalKes === 450);
assert("platform fee 45", fees.platformFeeKes === 45);
assert("seller net 405", fees.sellerNetKes === 405);

assert("no free shipping — min enforced", validateShippingKes(0).ok === false);
assert("valid shipping passes", validateShippingKes(150).ok === true);
assert("inferWeightClass shoes → medium", inferWeightClass("Women leather shoes") === "medium");

assert("order total 450", computeProductTotals({ priceKes: 300, shippingKes: 150 }).totalKes === 450);
assert("product list price includes shipping", formatProductListPrice({ priceKes: 300, shippingKes: 150 }).includes("450"));

console.log(`\n${failed ? failed + " failed" : "All seller fee tests passed"}`);
process.exit(failed ? 1 : 0);
