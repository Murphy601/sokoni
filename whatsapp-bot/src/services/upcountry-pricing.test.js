import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateFulfillmentMode } from "../lib/geo-zones.js";
import { quoteRiderLeg } from "./apply-order-shipping.js";

/**
 * Distance pricing is for boda deliveries only. Upcountry orders go by
 * courier, there is no rider, and the seller's own county tiers must keep
 * setting the price. These pin that boundary.
 */
describe("distance pricing only touches rider deliveries", () => {
  const route = (sellerCounty, buyerCounty, buyerTown) =>
    evaluateFulfillmentMode({
      sellerCounty,
      buyerCounty,
      buyerTown,
      sellerLocationText: sellerCounty,
      buyerLocationText: `${buyerTown}, ${buyerCounty}`,
    });

  const upcountry = [
    ["Nairobi", "Mombasa", "Nyali"],
    ["Nairobi", "Kisumu", "Milimani"],
    ["Nairobi", "Nakuru", "Naivasha"],
    ["Nairobi", "Uasin Gishu", "Eldoret"],
    ["Nairobi", "Kakamega", "Mumias"],
    ["Mombasa", "Nairobi", "Westlands"],
  ];

  for (const [s, bc, bt] of upcountry) {
    it(`${s} -> ${bt}, ${bc} keeps the seller's own rate`, () => {
      const f = route(s, bc, bt);
      assert.equal(f.requiresRider, false, `${bc} would be priced by distance`);
      assert.equal(f.mode, "SELLER_COURIER");
    });
  }

  const local = [
    ["Nairobi", "Nairobi", "Karen"],
    ["Westlands", "Kiambu", "Ruaka"],
    ["Nairobi", "Machakos", "Kitengela"],
    ["Nairobi", "Kiambu", "Thika"],
  ];

  for (const [s, bc, bt] of local) {
    it(`${s} -> ${bt}, ${bc} is priced by distance`, () => {
      assert.equal(route(s, bc, bt).requiresRider, true);
    });
  }

  it("quotes nothing to override with, upcountry", () => {
    // Behavioural rather than a source-text match: quoteRiderLeg is the one
    // place a distance fee can come from, so a null here is the guarantee
    // that the seller's own rate survives. An earlier version of this test
    // asserted the shape of the source and broke on a refactor that changed
    // nothing about the behaviour.
    for (const [s, bc, bt] of upcountry) {
      assert.equal(quoteRiderLeg({ sellerCity: s }, { buyerCounty: bc, buyerTown: bt }), null, `${bc}`);
    }
  });

  it("does quote one for metro deliveries", () => {
    for (const [s, bc, bt] of local) {
      const q = quoteRiderLeg({ sellerCity: s }, { buyerCounty: bc, buyerTown: bt });
      assert.ok(q && q.feeKes >= 350, `${s} -> ${bt}, ${bc} produced no rider fee`);
    }
  });
});
