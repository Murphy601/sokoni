#!/usr/bin/env node
/** Smoke test: AI shipping tiers + platform fee engine + variable M-Pesa fees. */
import {
  applyAiShippingSuggestion,
  computeFeeBreakdown,
  computeFeeBreakdownLegacy,
  computeOfferFeeBreakdown,
  computeProductTotals,
  computeSellerHandledFeeBreakdown,
  minBuyerTotalForOffer,
  formatProductListPrice,
  inferWeightClass,
  resolveSellerNetKes,
  resolveSellerPayoutKes,
  PLATFORM_FEE_RATE,
  validateShippingKes,
  getShippingTier,
  SHIPPING_TIERS,
} from "../src/services/shipping-tiers.js";
import { mpesaTransactionFeeKes } from "../src/services/mpesa-transaction-fees.js";

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

assert("mpesa fee free under 100", mpesaTransactionFeeKes(80) === 0);
assert("mpesa fee band 101-500 is 5", mpesaTransactionFeeKes(495) === 5);
assert("mpesa fee band 1501-2500 is 20", mpesaTransactionFeeKes(2299) === 20);
assert("mpesa fee high band capped 108", mpesaTransactionFeeKes(60000) === 108);

const fees = computeFeeBreakdown(300, 150);
assert("seller net 300", fees.sellerNetKes === 300);
assert("platform fee 45 (10%)", fees.platformFeeKes === 45);
assert("txn fee on 495 is 5", fees.transactionFeeKes === 5);
assert("buyer pays 500", fees.buyerTotalKes === 500);
assert("always 10% rate", fees.platformFeeRate === PLATFORM_FEE_RATE);

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
assert("seller listing buyer pays 500", sellerListing.totalKes === 500);
assert("seller listing net 300", sellerListing.sellerNetKes === 300);
assert("seller listing txn 5", sellerListing.transactionFeeKes === 5);

const freeProduct = computeProductTotals({ sellerNetKes: 300, freeShipping: true });
assert("free shipping seller net 300", freeProduct.sellerNetKes === 300);
assert("free shipping buyer 335", freeProduct.totalKes === 335);

assert("legacy order total 450", computeProductTotals({ priceKes: 300, shippingKes: 150 }).totalKes === 450);
assert("seller listing list price all-in", formatProductListPrice({ sellerNetKes: 300, shippingKes: 150 }).includes("500"));

const dbRow = { priceKes: 500, shippingKes: 175, sourcePriceKes: 300, platformFeeKes: 48, sellerNetKes: 300 };
assert("DB row resolves seller net", resolveSellerNetKes(dbRow) === 300);

assert("legacy item price not treated as all-in", resolveSellerNetKes({
  sourcePriceKes: 276,
  priceKes: 300,
  supplierId: "seller-adiv",
  name: "Yogurt",
}) == null);

// Accepted offer: amount_kes = agreed buyer all-in
const offer2000 = computeOfferFeeBreakdown(2000, 150);
assert("offer 2000 buyer total locked", offer2000.buyerTotalKes === 2000 && !offer2000.error);
assert("offer 2000 still ~10% platform", Math.abs(offer2000.platformFeeKes / offer2000.subtotalKes - 0.1) < 0.05);
assert("offer 2000 has txn fee field", offer2000.transactionFeeKes >= 0);

const offerTooLow = computeOfferFeeBreakdown(100, 150);
assert("offer too low for shipping errors", offerTooLow.error === "offer_too_low_for_shipping");

const offer300 = computeOfferFeeBreakdown(300, 150);
assert("offer 300 still covers ship+fee", !offer300.error && offer300.buyerTotalKes === 300);
assert("offer 300 seller net is NOT 300", offer300.sellerNetKes < 300);
assert(
  "offer 300 escrow lines cover buyer total",
  offer300.sellerNetKes + offer300.shippingKes + offer300.platformFeeKes + offer300.transactionFeeKes === 300
);

const minShip150 = minBuyerTotalForOffer(150);
assert("min offer with ship 150 is 171", minShip150 === 171);
const atMin = computeOfferFeeBreakdown(minShip150, 150);
assert("min offer valid", !atMin.error && atMin.sellerNetKes === 1);

const offerFreeShip = computeOfferFeeBreakdown(1100, 0, { freeShipping: true });
assert("offer free shipping buyer 1100", offerFreeShip.buyerTotalKes === 1100 && offerFreeShip.shippingKes === 0);

// Seller-handled: same 10% + variable M-Pesa; shipping goes to seller
const expressFees = computeFeeBreakdown(1840, 250, { deliveryMethod: "seller_express" });
assert("express subtotal 2090", expressFees.subtotalKes === 2090);
assert("express platform 10% = 209", expressFees.platformFeeKes === 209);
assert("express txn varies", expressFees.transactionFeeKes === 20);
assert("express buyer 2319", expressFees.buyerTotalKes === 2319);
assert("express seller payout 2090", expressFees.sellerPayoutKes === 2090);
assert("express shipping to seller", expressFees.shippingRecipient === "seller");
assert("express rate still 10%", expressFees.platformFeeRate === 0.1);

const meetupFees = computeFeeBreakdown(1840, 250, { deliveryMethod: "meetup" });
assert("meetup shipping 0", meetupFees.shippingKes === 0);
assert("meetup payout = item net", meetupFees.sellerPayoutKes === 1840);
assert("meetup still 10%", meetupFees.platformFeeRate === 0.1);

const expressProduct = computeProductTotals({
  sellerNetKes: 1840,
  shippingKes: 250,
  deliveryMethod: "seller_express",
});
assert("product express total 2319", expressProduct.totalKes === 2319);
assert("product express payout 2090", expressProduct.sellerPayoutKes === 2090);
assert(
  "resolveSellerPayoutKes order",
  resolveSellerPayoutKes({
    sellerNetKes: 1840,
    shippingKes: 250,
    shippingRecipient: "seller",
  }) === 2090
);
assert(
  "hub payout excludes shipping",
  resolveSellerPayoutKes({ sellerNetKes: 300, shippingKes: 150, deliveryMethod: "hub" }) === 300
);

const expressOffer = computeOfferFeeBreakdown(2319, 250, { deliveryMethod: "seller_express" });
assert("express offer buyer 2319", expressOffer.buyerTotalKes === 2319 && !expressOffer.error);
assert("express offer seller payout 2090", expressOffer.sellerPayoutKes === 2090);

assert("seller express shipping 0 ok", validateShippingKes(0, { deliveryMethod: "seller_express" }).ok);
assert("meetup forces 0 ship", validateShippingKes(250, { deliveryMethod: "meetup" }).shippingKes === 0);
assert(
  "direct seller-handled helper matches",
  computeSellerHandledFeeBreakdown(1840, 250).sellerPayoutKes === 2090
);

console.log(`\n${failed ? failed + " failed" : "All seller fee tests passed"}`);
process.exit(failed ? 1 : 0);
