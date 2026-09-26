import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quoteRiderLeg } from "./apply-order-shipping.js";
import { BASE_FEE_KES } from "../lib/rider-distance-fee.js";

const SRC = readFileSync(new URL("./apply-order-shipping.js", import.meta.url), "utf8");

describe("quoteRiderLeg", () => {
  it("prices a metro leg by distance", () => {
    const q = quoteRiderLeg({ sellerCity: "Westlands" }, { buyerCounty: "Machakos", buyerTown: "Kitengela" });
    assert.ok(q, "no quote for a metro leg");
    assert.equal(q.basis, "DISTANCE");
    assert.ok(q.feeKes > BASE_FEE_KES, `expected above the minimum, got ${q.feeKes}`);
  });

  it("returns null upcountry, leaving the seller's rate alone", () => {
    for (const [county, town] of [["Mombasa", "Nyali"], ["Kisumu", "Milimani"], ["Nakuru", "Naivasha"]]) {
      assert.equal(quoteRiderLeg({ sellerCity: "Westlands" }, { buyerCounty: county, buyerTown: town }), null, county);
    }
  });

  it("charges the minimum when the seller's location is unknown", () => {
    const q = quoteRiderLeg({}, { buyerCounty: "Nairobi", buyerTown: "Karen" });
    assert.equal(q.feeKes, BASE_FEE_KES);
  });

  it("prefers an explicit buyer pin over the town name", () => {
    const pinned = quoteRiderLeg(
      { sellerCity: "Westlands" },
      { buyerCounty: "Nairobi", buyerTown: "Karen", buyerCoordinates: { lat: -1.4564, lng: 36.9781 } }
    );
    const byTown = quoteRiderLeg({ sellerCity: "Westlands" }, { buyerCounty: "Nairobi", buyerTown: "Karen" });
    assert.notEqual(pinned.feeKes, byTown.feeKes, "the pin was ignored");
  });

  it("never throws on rubbish input", () => {
    for (const bad of [null, undefined, 5, { sellerCity: {} }]) {
      assert.doesNotThrow(() => quoteRiderLeg(bad, { buyerCounty: "Nairobi" }));
    }
  });
});

describe("the two gaps that made pricing look inert", () => {
  it("marks money as applied on a rider order from an unconfigured seller", () => {
    // shippingCalcMeta is built before riderQuote exists. Left at `configured`
    // it reads false, ensureHybridShippingBeforePayment re-runs, and the STK
    // gate treats a priced order as having no rates.
    assert.match(SRC, /patch\.shippingCalcMeta\.moneyApplied = true;/);
  });

  it("prices cart legs too, not just single orders", () => {
    const cart = SRC.slice(SRC.indexOf("function applyShippingToCartParent"));
    assert.match(cart, /quoteRiderLeg\(child, location, found\.profile\)/);
    assert.match(cart, /if \(configured \|\| childQuote\) \{/);
    assert.match(cart, /moneyApplied: configured \|\| Boolean\(childQuote\)/);
  });

  it("prices a cart leg and the same item bought alone identically", () => {
    const line = { sellerCity: "Westlands" };
    const loc = { buyerCounty: "Machakos", buyerTown: "Kitengela" };
    assert.equal(quoteRiderLeg(line, loc).feeKes, quoteRiderLeg({ ...line }, { ...loc }).feeKes);
  });
});
