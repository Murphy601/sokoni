import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFulfillmentMode,
  FULFILLMENT_LOCAL_RIDER,
  FULFILLMENT_SELLER_COURIER,
  normalizeCountyKey,
} from "./geo-zones.js";

describe("geo-zones", () => {
  it("normalizes Thika to Kiambu local zone", () => {
    assert.equal(normalizeCountyKey("Thika"), "KIAMBU");
  });

  it("routes Nairobi→Kiambu to local rider", () => {
    const r = evaluateFulfillmentMode({
      sellerCounty: "Nairobi",
      buyerCounty: "Kiambu",
      buyerTown: "Thika",
    });
    assert.equal(r.mode, FULFILLMENT_LOCAL_RIDER);
    assert.equal(r.requiresRider, true);
    assert.equal(r.escrowHoldMinutes, 15);
  });

  it("routes Nairobi→Kisumu to seller courier", () => {
    const r = evaluateFulfillmentMode({
      sellerCounty: "Nairobi",
      buyerCounty: "Kisumu",
    });
    assert.equal(r.mode, FULFILLMENT_SELLER_COURIER);
    assert.equal(r.requiresRider, false);
    assert.equal(r.autoReleaseHours, 48);
  });
});
