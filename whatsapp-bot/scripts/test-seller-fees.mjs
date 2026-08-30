#!/usr/bin/env node
/** Smoke test: platform item fee + 5% shipping commission + banded M-Pesa fees. */
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
  shippingCommissionKes,
  PLATFORM_FEE_RATE,
  SHIPPING_COMMISSION_RATE,
  MIN_SHIPPING_KES,
  validateShippingKes,
  getShippingTier,
  SHIPPING_TIERS,
  DELIVERY_METHODS,
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
assert("min shipping floor 300", MIN_SHIPPING_KES === 300);
assert("shipping commission 5%", SHIPPING_COMMISSION_RATE === 0.05);
assert("small tier starts at 300", getShippingTier("small").minKes === 300 && getShippingTier("small").typicalKes === 300);
assert("meetup not a selectable delivery method", !DELIVERY_METHODS.some((d) => d.id === "meetup"));

const yogurt = applyAiShippingSuggestion({ name: "Delamere Premium Yogurt" });
assert("AI shipping always 0", yogurt.shippingKes === 0);
assert("AI free shipping", yogurt.freeShipping === true);

assert("mpesa fee free under 100", mpesaTransactionFeeKes(80) === 0);
assert("mpesa fee band ~150 is 7", mpesaTransactionFeeKes(150) === 7);
assert("mpesa fee band 101-500 is 7", mpesaTransactionFeeKes(495) === 7);
assert("mpesa fee band 501-1000 is 13", mpesaTransactionFeeKes(630) === 13);
assert("mpesa fee band 1501-2500 is 33", mpesaTransactionFeeKes(2299) === 33);
assert("mpesa fee high band capped 108", mpesaTransactionFeeKes(60000) === 108);

// Hub: 10% on item only; shipping stays with platform; no 5% seller ship cut
const hubFees = computeFeeBreakdown(300, 300);
assert("hub seller net 300", hubFees.sellerNetKes === 300);
assert("hub platform fee 30 (10% of item)", hubFees.platformFeeKes === 30);
assert("hub no seller shipping commission", hubFees.shippingCommissionKes === 0);
assert("hub txn on 630 is 13", hubFees.transactionFeeKes === 13);
assert("hub buyer pays 643", hubFees.buyerTotalKes === 643);
assert("hub seller payout excludes shipping", hubFees.sellerPayoutKes === 300);
assert("hub clamps sub-300 ship up", computeFeeBreakdown(300, 150).shippingKes === 300);

const legacyFees = computeFeeBreakdownLegacy(300, 300);
assert("legacy buyer pays 600", legacyFees.buyerTotalKes === 600);

assert("free shipping validates", validateShippingKes(0, { freeShipping: true }).ok === true);
assert("valid shipping passes", validateShippingKes(300).ok === true);

assert("inferWeightClass dress → small", inferWeightClass("Summer floral dress") === "small");

const freeProduct = computeProductTotals({ sellerNetKes: 300, freeShipping: true });
assert("free shipping seller net 300", freeProduct.sellerNetKes === 300);
// 300 + 30 platform + 7 txn (330 band) = 337
assert("free shipping buyer 337", freeProduct.totalKes === 337);

assert("shippingCommission helper", shippingCommissionKes(200, { shippingRecipient: "seller" }) === 10);
assert("shippingCommission hub 0", shippingCommissionKes(200, { deliveryMethod: "hub" }) === 0);

// User example shape: item 1000 + ship 350 seller_express
const demo = computeFeeBreakdown(1000, 350, { deliveryMethod: "seller_express" });
assert("demo platform 100", demo.platformFeeKes === 100);
assert("demo ship commission 18", demo.shippingCommissionKes === 18);
assert("demo buyer ship unchanged 350", demo.shippingKes === 350);
assert("demo seller payout 1000+332", demo.sellerPayoutKes === 1332);
assert(
  "demo retain = buyer - seller payout",
  demo.platformRetainKes === demo.buyerTotalKes - demo.sellerPayoutKes
);
assert(
  "demo escrow lines",
  demo.sellerNetKes + demo.shippingKes + demo.platformFeeKes + demo.transactionFeeKes === demo.buyerTotalKes
);

// Seller-handled express
const expressFees = computeFeeBreakdown(1840, 250, { deliveryMethod: "seller_express" });
assert("express platform 10% of item = 184", expressFees.platformFeeKes === 184);
assert("express ship commission 13", expressFees.shippingCommissionKes === 13);
assert("express buyer ship 250", expressFees.shippingKes === 250);
assert("express seller payout 2077", expressFees.sellerPayoutKes === 2077);
assert("express shipping to seller", expressFees.shippingRecipient === "seller");
// chargeBefore = 1840+250+184 = 2274 → txn 33 → buyer 2307
assert("express buyer 2307", expressFees.buyerTotalKes === 2307);

const meetupFees = computeFeeBreakdown(1840, 250, { deliveryMethod: "meetup" });
assert("meetup shipping 0", meetupFees.shippingKes === 0);
assert("meetup payout = item net", meetupFees.sellerPayoutKes === 1840);

const expressProduct = computeProductTotals({
  sellerNetKes: 1840,
  shippingKes: 250,
  deliveryMethod: "seller_express",
});
// Listing shippingKes is ignored — Hub matrix prices at checkout only.
assert("product listing shipping ignored", expressProduct.shippingKes === 0);
assert("product express total item-only 2057", expressProduct.totalKes === 2057);
assert("product express payout item-only 1840", expressProduct.sellerPayoutKes === 1840);
assert("product shippingSource pending_hub", expressProduct.shippingSource === "pending_hub");
assert(
  "resolveSellerPayoutKes applies 5%",
  resolveSellerPayoutKes({
    sellerNetKes: 1840,
    shippingKes: 250,
    shippingRecipient: "seller",
  }) === 2077
);
assert(
  "resolveSellerPayoutKes uses stored commission",
  resolveSellerPayoutKes({
    sellerNetKes: 1840,
    shippingKes: 250,
    shippingCommissionKes: 13,
    shippingRecipient: "seller",
  }) === 2077
);
assert(
  "hub payout excludes shipping",
  resolveSellerPayoutKes({ sellerNetKes: 300, shippingKes: 300, deliveryMethod: "hub" }) === 300
);

const expressOffer = computeOfferFeeBreakdown(expressFees.buyerTotalKes, 250, {
  deliveryMethod: "seller_express",
});
assert("express offer locks buyer total", expressOffer.buyerTotalKes === expressFees.buyerTotalKes && !expressOffer.error);
assert("express offer seller payout 2077", expressOffer.sellerPayoutKes === 2077);
assert(
  "express offer escrow covers buyer",
  expressOffer.sellerNetKes +
    expressOffer.shippingKes +
    expressOffer.platformFeeKes +
    expressOffer.transactionFeeKes ===
    expressOffer.buyerTotalKes
);

const minShip300 = minBuyerTotalForOffer(300, { deliveryMethod: "seller_express" });
const atMin = computeOfferFeeBreakdown(minShip300, 300, { deliveryMethod: "seller_express" });
assert("min offer valid", !atMin.error && atMin.sellerNetKes === 1);

assert("seller express shipping 0 ok", validateShippingKes(0, { deliveryMethod: "seller_express" }).ok);
assert(
  "direct seller-handled helper matches",
  computeSellerHandledFeeBreakdown(1840, 250).sellerPayoutKes === 2077
);

const listingPrice = formatProductListPrice({ sellerNetKes: 300, freeShipping: true });
assert("list price uses new buyer total", listingPrice.includes("337"));

const dbRow = { priceKes: 337, shippingKes: 0, sourcePriceKes: 300, platformFeeKes: 30, sellerNetKes: 300 };
assert("DB row resolves seller net", resolveSellerNetKes(dbRow) === 300);

console.log(`\n${failed ? failed + " failed" : "All seller fee tests passed"}`);
process.exit(failed ? 1 : 0);
