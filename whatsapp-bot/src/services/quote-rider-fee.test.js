import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { quoteShippingForPending } from "./prepaid-order-steps.js";
import { BASE_FEE_KES, MAX_FEE_KES } from "../lib/rider-distance-fee.js";
import { upsertVendorShippingProfile, normalizeVendorKey } from "./vendor-shipping.js";

// The fee override replaces a configured seller's rate; it does not bypass the
// fail-closed rule, so the test seller needs real Hub rates on file.
const SHOP = normalizeVendorKey("rider_fee_test_shop");
upsertVendorShippingProfile(SHOP, {
  shippingType: "FLAT_RATE",
  flatLocalRateKes: 500,
  flatUpcountryRateKes: 500,
  isFreeShippingEnabled: false,
});

/**
 * The WhatsApp quote is what the buyer sees and agrees to, and it runs before
 * any order row exists -- applyShippingToOrder never touches it. Distance
 * pricing that is not applied here is not applied at all.
 */
const pending = {
  priceKes: 68,
  shopHandle: SHOP,
  sellerCity: "Westlands",
  productName: "Imperial Leather Body Lotion",
};

describe("rider fee on the WhatsApp quote", () => {
  const quote = (county, town, tier = 1) =>
    quoteShippingForPending(pending, { county, town, tier });

  it("charges the minimum for a short metro hop", () => {
    const q = quote("Nairobi", "Kilimani");
    assert.equal(q.ok, true, q.error);
    assert.equal(q.shippingKes, BASE_FEE_KES);
  });

  it("charges more the further it goes", () => {
    const near = quote("Nairobi", "Kilimani").shippingKes;
    const mid = quote("Nairobi", "Karen").shippingKes;
    const far = quote("Machakos", "Kitengela").shippingKes;
    assert.ok(near < mid && mid < far, `${near} / ${mid} / ${far} is not increasing`);
    assert.ok(far <= MAX_FEE_KES, `${far} exceeds the cap`);
  });

  it("labels the quote so the source of the fee is visible", () => {
    assert.match(quote("Nairobi", "Karen").methodUsed, /^RIDER_/);
  });

  it("does not license selling without any rates on file", () => {
    // The rider fee replaces a configured seller's rate. It is not a way
    // around the fail-closed rule, which exists so no STK goes out on an
    // order whose delivery cost nobody set.
    const q = quoteShippingForPending(
      { priceKes: 68, shopHandle: "no-profile-at-all", sellerCity: "Westlands" },
      { county: "Nairobi", town: "Karen", tier: 1 }
    );
    assert.equal(q.ok, false);
    assert.equal(q.error, "missing_shipping_rates");
  });

  it("leaves upcountry on the seller's own rate", () => {
    const q = quote("Mombasa", "Nyali", 3);
    assert.equal(q.ok, true, q.error);
    assert.equal(q.shippingKes, 500, "seller's upcountry rate was overridden");
    assert.doesNotMatch(q.methodUsed || "", /^RIDER_/);
  });

  it("charges the minimum when the seller's location is unknown", () => {
    const q = quoteShippingForPending(
      { priceKes: 68, shopHandle: SHOP },
      { county: "Nairobi", town: "Karen", tier: 1 }
    );
    assert.equal(q.ok, true, q.error);
    assert.equal(q.shippingKes, BASE_FEE_KES);
  });

  it("never returns free delivery on a rider leg", () => {
    // Free shipping cannot apply here: the fee is what pays the rider.
    for (const town of ["Kilimani", "Karen", "Thika"]) {
      const q = quote("Nairobi", town);
      assert.ok(q.shippingKes >= BASE_FEE_KES, `${town} came back at ${q.shippingKes}`);
    }
  });
});
