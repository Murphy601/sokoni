import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_FEE_KES,
  MAX_FEE_KES,
  INCLUDED_KM,
  feeForRoadKm,
  roadKm,
  priceLocalDelivery,
  describeFee,
} from "./rider-distance-fee.js";
import { haversineMeters } from "../services/boda-fleet.js";
import { calculateDeliveryPayoutSplit } from "./rider-payout-fees.js";
import { RIDER_SINGLE_FEE_MANUAL_KES, RIDER_B2C_MIN_FLOOR_KES } from "./rider-b2c-guards.js";

describe("the agreed tariff", () => {
  // Straight-line km -> fee, the numbers signed off on.
  const agreed = [
    [3, 400],
    [8, 540],
    [15, 760],
    [30, 1250],
  ];
  for (const [straight, expected] of agreed) {
    it(`${straight} km costs KES ${expected}`, () => {
      assert.equal(feeForRoadKm(roadKm(straight)), expected);
    });
  }
});

describe("floor and ceiling", () => {
  it("never goes below the minimum, however short", () => {
    for (const km of [0, 0.1, 1, 4.9, INCLUDED_KM]) {
      assert.equal(feeForRoadKm(km), BASE_FEE_KES, `${km} km`);
    }
  });

  it("never exceeds the cap, however far", () => {
    for (const km of [50, 200, 5000]) {
      assert.equal(feeForRoadKm(km), MAX_FEE_KES, `${km} km`);
    }
  });

  it("sits exactly on the auto-clear boundary, not over it", () => {
    // needsApproval is `fee > RIDER_SINGLE_FEE_MANUAL_KES`, so 1500 clears
    // automatically and 1501 would not. The cap is deliberately on the line;
    // this pins it there so a later raise cannot quietly send every long
    // delivery to an ops queue.
    assert.equal(MAX_FEE_KES, RIDER_SINGLE_FEE_MANUAL_KES);
    assert.equal(MAX_FEE_KES > RIDER_SINGLE_FEE_MANUAL_KES, false);
  });

  it("stays at or under the manual-approval line at every distance", () => {
    // A fee over this drops the payout into NEEDS_APPROVAL and makes ops
    // clear it by hand. No delivery should ever do that on distance alone.
    for (let km = 0; km <= 500; km += 0.5) {
      assert.ok(feeForRoadKm(km) <= RIDER_SINGLE_FEE_MANUAL_KES, `${km} km exceeds the cap`);
    }
  });

  it("clears the B2C payout floor even at the minimum fee", () => {
    const split = calculateDeliveryPayoutSplit(BASE_FEE_KES);
    assert.ok(
      split.netRiderPayout >= RIDER_B2C_MIN_FLOOR_KES,
      `rider nets ${split.netRiderPayout}, floor is ${RIDER_B2C_MIN_FLOOR_KES}`
    );
    assert.equal(split.netRiderPayout, 345);
  });
});

describe("shape of the curve", () => {
  it("never charges less for a longer trip", () => {
    let prev = 0;
    for (let km = 0; km <= 120; km += 0.25) {
      const f = feeForRoadKm(km);
      assert.ok(f >= prev, `fee dropped at ${km} km`);
      prev = f;
    }
  });

  it("quotes in round tens", () => {
    for (let km = 0; km <= 80; km += 0.3) {
      assert.equal(feeForRoadKm(km) % 10, 0, `${km} km is not a round ten`);
    }
  });

  it("treats rubbish input as zero distance, not as free", () => {
    for (const bad of [NaN, -5, null, undefined, "abc", Infinity]) {
      assert.equal(feeForRoadKm(bad), BASE_FEE_KES, String(bad));
    }
  });
});

describe("pricing a real delivery", () => {
  // Nairobi CBD and Westlands, roughly 4 km apart in a straight line.
  const cbd = { lat: -1.2864, lng: 36.8172 };
  const westlands = { lat: -1.2673, lng: 36.8065 };
  const thika = { lat: -1.0333, lng: 37.0693 };

  it("charges the minimum across town centre", () => {
    const q = priceLocalDelivery(cbd, westlands, haversineMeters);
    assert.equal(q.feeKes, BASE_FEE_KES);
    assert.equal(q.basis, "DISTANCE");
    assert.ok(q.straightLineKm > 1 && q.straightLineKm < 5, `got ${q.straightLineKm} km`);
  });

  it("charges more to Thika, and caps it", () => {
    const q = priceLocalDelivery(cbd, thika, haversineMeters);
    assert.ok(q.feeKes > BASE_FEE_KES);
    assert.equal(q.feeKes, MAX_FEE_KES);
    assert.equal(q.basis, "DISTANCE_CAPPED");
  });

  it("falls back to the minimum when either pin is missing", () => {
    for (const [a, b] of [[null, westlands], [cbd, null], [null, null], [{}, westlands]]) {
      const q = priceLocalDelivery(a, b, haversineMeters);
      assert.equal(q.feeKes, BASE_FEE_KES);
      assert.equal(q.basis, "MINIMUM_NO_COORDS");
      assert.equal(q.roadKm, null);
    }
  });

  it("falls back rather than throwing when the distance function misbehaves", () => {
    for (const fn of [() => NaN, () => -1, null]) {
      assert.equal(priceLocalDelivery(cbd, thika, fn).feeKes, BASE_FEE_KES);
    }
  });

  it("is symmetric — direction of travel does not change the price", () => {
    assert.equal(
      priceLocalDelivery(cbd, thika, haversineMeters).feeKes,
      priceLocalDelivery(thika, cbd, haversineMeters).feeKes
    );
  });

  it("describes the fee for a buyer", () => {
    assert.match(describeFee(priceLocalDelivery(cbd, thika, haversineMeters)), new RegExp(`KES ${MAX_FEE_KES.toLocaleString()} delivery`));
    assert.match(describeFee(priceLocalDelivery(null, null, haversineMeters)), /minimum — no map pin/);
  });
});
