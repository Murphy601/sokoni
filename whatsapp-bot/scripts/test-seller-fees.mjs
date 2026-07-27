#!/usr/bin/env node
/** Smoke test: AI shipping tiers + platform fee engine. */
import {
  applyAiShippingSuggestion,
  computeFeeBreakdown,
  computeProductTotals,
  orderBuyerTotal,
  formatProductListPrice,
  inferWeightClass,
  MIN_SHIPPING_KES,
  validateShippingKes,
  getShippingTier,
  SHIPPING_TIERS,
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

assert("3 shipping tiers", SHIPPING_TIERS.length === 3);
assert("small tier 150-200", getShippingTier("small").minKes === 150 && getShippingTier("small").maxKes === 200);
assert("medium tier 250-300", getShippingTier("medium").typicalKes === 275);
assert("large tier 350-500", getShippingTier("large").maxKes === 500);

const yogurt = applyAiShippingSuggestion({ name: "Delamere Premium Yogurt" });
assert("yogurt weight class small", yogurt.estimatedWeightClass === "small");
assert("yogurt shipping typical 175", yogurt.shippingKes === 175);

const shoes = applyAiShippingSuggestion({ name: "Women leather shoes", estimatedWeightClass: "medium" });
assert("shoes medium fee 275", shoes.shippingKes === 275);

const fees = computeFeeBreakdown(300, 150);
assert("buyer pays 450", fees.buyerTotalKes === 450);
assert("platform fee 45", fees.platformFeeKes === 45);
assert("seller net 405", fees.sellerNetKes === 405);

assert("free shipping validates", validateShippingKes(0, { freeShipping: true }).ok === true);
assert("no shipping without free flag fails", validateShippingKes(0).ok === false);
assert("valid shipping passes", validateShippingKes(150).ok === true);

assert("inferWeightClass dress → small", inferWeightClass("Summer floral dress") === "small");
assert("inferWeightClass shoes → medium", inferWeightClass("Women leather shoes") === "medium");
assert("inferWeightClass boots → large", inferWeightClass("Leather winter boots") === "large");

const freeProduct = computeProductTotals({ priceKes: 300, freeShipping: true });
assert("free shipping product total 300", freeProduct.totalKes === 300 && freeProduct.shippingKes === 0);

assert("order total 450", computeProductTotals({ priceKes: 300, shippingKes: 150 }).totalKes === 450);
assert("product list price includes shipping", formatProductListPrice({ priceKes: 300, shippingKes: 150 }).includes("450"));

console.log(`\n${failed ? failed + " failed" : "All seller fee tests passed"}`);
process.exit(failed ? 1 : 0);
