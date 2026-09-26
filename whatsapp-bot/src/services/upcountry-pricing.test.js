import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateFulfillmentMode } from "../lib/geo-zones.js";

const SRC = readFileSync(new URL("./apply-order-shipping.js", import.meta.url), "utf8");

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

  it("only overrides the fee when a rider is involved", () => {
    // The override is gated on riderQuote, which is only set under
    // fulfillment.requiresRider. If that gate is ever removed, upcountry
    // sellers silently lose control of their own pricing.
    assert.match(SRC, /if \(fulfillment\.requiresRider\) \{/);
    assert.match(SRC, /riderQuote\s*\?\s*riderQuote\.feeKes\s*:\s*Math\.round\(Number\(line\.shippingFee\)/);
  });

  it("leaves the seller's configured tiers as the source for everything else", () => {
    // Non-rider orders still require a configured profile before any money
    // is rewritten -- unchanged behaviour.
    assert.match(SRC, /if \(configured \|\| riderQuote\) \{/);
  });
});
