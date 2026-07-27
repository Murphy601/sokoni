#!/usr/bin/env node
/** Smoke test: AI shipping tiers + platform fee engine. */
import {
  applyAiShippingSuggestion,
  computeFeeBreakdown,
  computeFeeBreakdownLegacy,
  computeProductTotals,
  orderBuyerTotal,
  formatProductListPrice,
  inferWeightClass,
  resolveSellerNetKes,
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
assert("seller net 300", fees.sellerNetKes === 300);
assert("buyer pays 495", fees.buyerTotalKes === 495);
assert("platform fee 45", fees.platformFeeKes === 45);

const legacyFees = computeFeeBreakdownLegacy(300, 150);
assert("legacy buyer pays 450", legacyFees.buyerTotalKes === 450);
assert("legacy seller net 405", legacyFees.sellerNetKes === 405);

assert("free shipping validates", validateShippingKes(0, { freeShipping: true }).ok === true);
assert("no shipping without free flag fails", validateShippingKes(0).ok === false);
assert("valid shipping passes", validateShippingKes(150).ok === true);

assert("inferWeightClass dress → small", inferWeightClass("Summer floral dress") === "small");
assert("inferWeightClass shoes → medium", inferWeightClass("Women leather shoes") === "medium");
assert("inferWeightClass boots → large", inferWeightClass("Leather winter boots") === "large");

const sellerListing = computeProductTotals({ sellerNetKes: 300, shippingKes: 150 });
assert("seller listing buyer pays 495", sellerListing.totalKes === 495);
assert("seller listing net 300", sellerListing.sellerNetKes === 300);

const freeProduct = computeProductTotals({ sellerNetKes: 300, freeShipping: true });
assert("free shipping seller net 300", freeProduct.sellerNetKes === 300 && freeProduct.totalKes === 330);

assert("legacy order total 450", computeProductTotals({ priceKes: 300, shippingKes: 150 }).totalKes === 450);
assert("seller listing list price all-in", formatProductListPrice({ sellerNetKes: 300, shippingKes: 150 }).includes("495"));

const dbRow = { priceKes: 523, shippingKes: 175, sourcePriceKes: 300, platformFeeKes: 48 };
assert("DB row resolves seller net", resolveSellerNetKes(dbRow) === 300);
assert("DB row buyer total 523", computeProductTotals(dbRow).totalKes === 523);

const dbSellerOnly = { priceKes: 523, shippingKes: 175, sellerId: 7 };
assert("DB sellerId infers seller net", resolveSellerNetKes(dbSellerOnly) === 300);
assert("DB sellerId buyer total 523", computeProductTotals(dbSellerOnly).totalKes === 523);

const legacyYogurt = { sourcePriceKes: 276, priceKes: 300, supplierId: "seller-adiv", name: "Yogurt" };
assert("legacy item price not treated as all-in", resolveSellerNetKes(legacyYogurt) == null);
assert("legacy yogurt total 475", computeProductTotals(legacyYogurt).totalKes === 475);

console.log(`\n${failed ? failed + " failed" : "All seller fee tests passed"}`);
process.exit(failed ? 1 : 0);
