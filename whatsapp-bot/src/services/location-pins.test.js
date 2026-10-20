import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SELLER_STEPS, SELLER_STEP_COUNT, promptFor as sellerPrompt } from "./seller-onboarding.js";
import { promptFor as riderPrompt, RIDER_STEPS } from "./rider-onboarding.js";
import { quoteRiderLeg, resolveSellerPin } from "./apply-order-shipping.js";
import { BASE_FEE_KES } from "../lib/rider-distance-fee.js";

const RIDER = readFileSync(new URL("./rider-onboarding.js", import.meta.url), "utf8");
const SELLER = readFileSync(new URL("./seller-onboarding.js", import.meta.url), "utf8");
const MENU = readFileSync(new URL("./menu.js", import.meta.url), "utf8");
const APPLY_HTML = readFileSync(new URL("../../../website/boda/apply.html", import.meta.url), "utf8");

describe("sellers are asked for a pickup pin", () => {
  it("has a step for it", () => {
    assert.ok(SELLER_STEPS.PICKUP_PIN);
    assert.equal(SELLER_STEP_COUNT, 6);
  });

  it("explains why, and how to send it", () => {
    const p = sellerPrompt(SELLER_STEPS.PICKUP_PIN, {});
    assert.match(p, /riders collect/i);
    assert.match(p, /Attach/i);
  });

  it("is required, with a real alternative rather than a dead end", () => {
    const branch = SELLER.slice(SELLER.indexOf("case SELLER_STEPS.PICKUP_PIN: {"));
    const body = branch.slice(0, 1600);
    assert.doesNotMatch(sellerPrompt(SELLER_STEPS.PICKUP_PIN, {}), /\*skip\*/i, "still offers skip");
    assert.match(body, /suppliers\/list\.html/, "no route out for a phone that will not share");
  });

  it("accepts the pin from a location message, not typed text", () => {
    const branch = SELLER.slice(SELLER.indexOf("case SELLER_STEPS.PICKUP_PIN: {"));
    assert.match(branch.slice(0, 900), /normalizePin\(location\)/);
  });
});

describe("riders are asked for a stage pin", () => {
  it("asks on the stage step and says what it decides", () => {
    const p = riderPrompt(RIDER_STEPS.STAGE, {});
    assert.match(p, /stage/i);
    assert.match(p, /Attach/i);
    assert.match(p, /nearest|reach you|jobs/i, "does not say why it matters");
  });

  it("takes the pin from a location message", () => {
    const branch = RIDER.slice(RIDER.indexOf("case RIDER_STEPS.STAGE: {"));
    assert.match(branch.slice(0, 1600), /normalizePin\(location\)/);
  });

  it("does not trap someone who cannot send one", () => {
    const branch = RIDER.slice(RIDER.indexOf("case RIDER_STEPS.STAGE: {"));
    assert.match(branch.slice(0, 1600), /isSkip\(t\)/);
  });
});

describe("buyers can drop a pin at the order step", () => {
  it("accepts a location message on the delivery step", () => {
    const branch = MENU.slice(MENU.indexOf("if (step === ORDER_STEPS.LOCATION) {"));
    assert.match(branch.slice(0, 1400), /normalizePin\(location\)/);
    assert.match(branch.slice(0, 1400), /buyerLat/);
  });

  it("still takes a typed county/town, so a pin is never required", () => {
    const branch = MENU.slice(MENU.indexOf("if (step === ORDER_STEPS.LOCATION) {"));
    assert.match(branch.slice(0, 2000), /parseLocationStep\(text\)/);
  });
});

describe("a pin actually changes the price", () => {
  it("beats the locality centre it would otherwise use", () => {
    // Same seller town, but the pin is across the city. If the pin were
    // ignored both would price identically.
    const byName = quoteRiderLeg({ sellerCity: "Nairobi" }, { buyerCounty: "Nairobi", buyerTown: "Karen" });
    const byPin = quoteRiderLeg(
      { sellerCity: "Nairobi", pickupLat: -1.0333, pickupLng: 37.0693 },
      { buyerCounty: "Nairobi", buyerTown: "Karen" }
    );
    assert.ok(byName && byPin);
    assert.notEqual(byName.feeKes, byPin.feeKes, "the pin was ignored");
    assert.ok(byPin.feeKes > byName.feeKes);
  });

  it("ignores a pin that is not a real Kenyan position", () => {
    assert.equal(resolveSellerPin({ pickupLat: 0, pickupLng: 0 }), null);
    assert.equal(resolveSellerPin({ pickupLat: 51.5, pickupLng: -0.12 }), null);
    assert.equal(resolveSellerPin({}), null);
  });

  it("falls back to the minimum, not an error, with no pin and no city", () => {
    const q = quoteRiderLeg({}, { buyerCounty: "Nairobi", buyerTown: "Karen" });
    assert.equal(q.feeKes, BASE_FEE_KES);
  });
});

describe("the web form offers the same thing", () => {
  it("has a pin field wired to hidden inputs", () => {
    assert.ok(APPLY_HTML.includes("data-pin-field"));
    assert.ok(APPLY_HTML.includes('id="stageLat"'));
    assert.ok(APPLY_HTML.includes('id="stageLng"'));
  });

  it("offers both the device location and a map", () => {
    assert.ok(APPLY_HTML.includes("data-pin-use"));
    assert.ok(APPLY_HTML.includes("data-pin-map"));
  });

  it("does not make it required", () => {
    const field = APPLY_HTML.slice(APPLY_HTML.indexOf("data-pin-field"), APPLY_HTML.indexOf("data-pin-status"));
    assert.ok(!/\brequired\b/.test(field), "the pin field is marked required");
  });
});
