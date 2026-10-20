import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeRiderDispatchScore,
  distanceTier,
  rankRidersByDispatchScore,
  TIER1_MAX_KM,
  TIER2_MAX_KM,
  LATE_PICKUP_MINUTES,
  LATE_PICKUP_PENALTY,
} from "./dispatch-matcher.js";

describe("dispatch-matcher", () => {
  it("tiers distance bands", () => {
    assert.equal(distanceTier(2000), "TIER1");
    assert.equal(distanceTier(TIER1_MAX_KM * 1000), "TIER1");
    assert.equal(distanceTier(5000), "TIER2");
    assert.equal(distanceTier(TIER2_MAX_KM * 1000), "TIER2");
    assert.equal(distanceTier(8000), "TOO_FAR");
  });

  it("scores higher rating ahead of farther lower-rated peer", () => {
    const nearLow = computeRiderDispatchScore({ rating: 4.1, distanceM: 1000, acceptanceRate: 80 });
    const nearHigh = computeRiderDispatchScore({ rating: 4.9, distanceM: 1200, acceptanceRate: 80 });
    assert.ok(nearHigh > nearLow);
  });

  it("ranks Tier1 before Tier2 and drops TOO_FAR", () => {
    const ranked = rankRidersByDispatchScore([
      { id: 1, rating: 5, distanceM: 8000, acceptanceRate: 90 },
      { id: 2, rating: 4.2, distanceM: 4500, acceptanceRate: 70 },
      { id: 3, rating: 4.8, distanceM: 1500, acceptanceRate: 75 },
      { id: 4, rating: 4.9, distanceM: 2000, acceptanceRate: 80 },
    ]);
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].id, 3); // higher score (closer outweighs 0.1 rating gap)
    assert.equal(ranked[0].tier, "TIER1");
    assert.ok(ranked.every((r) => r.tier !== "TOO_FAR"));
    assert.equal(ranked[ranked.length - 1].tier, "TIER2");
  });

  it("pickup SLA is 15 minutes with −0.2 late penalty", () => {
    assert.equal(LATE_PICKUP_MINUTES, 15);
    assert.equal(LATE_PICKUP_PENALTY, 0.2);
  });
});
