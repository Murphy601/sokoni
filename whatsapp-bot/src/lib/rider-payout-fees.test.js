import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getMpesaB2CTariff,
  calculateDeliveryPayoutSplit,
} from "./rider-payout-fees.js";

describe("getMpesaB2CTariff", () => {
  it("returns 0 at or below 100", () => {
    assert.equal(getMpesaB2CTariff(100), 0);
    assert.equal(getMpesaB2CTariff(50), 0);
  });
  it("returns band fees", () => {
    assert.equal(getMpesaB2CTariff(270), 15);
    assert.equal(getMpesaB2CTariff(1500), 23);
    assert.equal(getMpesaB2CTariff(8000), 28);
    assert.equal(getMpesaB2CTariff(25000), 33);
  });
});

describe("calculateDeliveryPayoutSplit", () => {
  it("matches KES 300 example", () => {
    const split = calculateDeliveryPayoutSplit(300);
    assert.equal(split.originalDeliveryFee, 300);
    assert.equal(split.platformCommission, 30);
    assert.equal(split.grossRiderAmount, 270);
    assert.equal(split.mpesaTariff, 15);
    assert.equal(split.netRiderPayout, 255);
  });
});
