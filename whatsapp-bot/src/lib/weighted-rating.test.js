import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWeightedStar,
  applyRatingDelta,
  deriveBadgeTier,
  clampRating,
  RATING_DELTAS,
  BADGE_DEMOTION_FLOOR,
} from "./weighted-rating.js";

test("weighted star: first 5★ → 5.0", () => {
  const r = applyWeightedStar(0, 0, 5);
  assert.equal(r.rating, 5);
  assert.equal(r.reviewCount, 1);
});

test("weighted star: 5 then 1 → 3.0", () => {
  const a = applyWeightedStar(0, 0, 5);
  const b = applyWeightedStar(a.rating, a.reviewCount, 1);
  assert.equal(b.rating, 3);
  assert.equal(b.reviewCount, 2);
});

test("weighted star: blueprint sequence 5,1,5,4", () => {
  let s = applyWeightedStar(0, 0, 5);
  s = applyWeightedStar(s.rating, s.reviewCount, 1);
  s = applyWeightedStar(s.rating, s.reviewCount, 5);
  assert.equal(s.rating, 3.67); // 11/3
  s = applyWeightedStar(s.rating, s.reviewCount, 4);
  assert.equal(s.rating, 3.75); // 15/4
  assert.equal(s.reviewCount, 4);
});

test("first review ignores legacy default 5.0 when count is 0", () => {
  const r = applyWeightedStar(5, 0, 1);
  assert.equal(r.rating, 1);
  assert.equal(r.reviewCount, 1);
});

test("delta penalties do not change review count", () => {
  const r = applyRatingDelta(4.5, RATING_DELTAS.BUYER_WON_DISPUTE, 10);
  assert.equal(r.rating, 4);
  assert.equal(r.reviewCount, 10);
});

test("clampRating bounds", () => {
  assert.equal(clampRating(-1), 0);
  assert.equal(clampRating(9), 5);
  assert.equal(clampRating(4.567), 4.57);
});

test("badge tiers: newbie → verified → top → legend", () => {
  assert.equal(deriveBadgeTier({}).tier, "newbie");
  assert.equal(
    deriveBadgeTier({ completedOrders: 10, rating: 4.0, isVerified: true }).tier,
    "verified"
  );
  assert.equal(
    deriveBadgeTier({
      completedOrders: 50,
      rating: 4.7,
      isVerified: true,
      disputeCount: 0,
    }).tier,
    "top_rated"
  );
  assert.equal(
    deriveBadgeTier({
      completedOrders: 200,
      rating: 4.9,
      isVerified: true,
      unresolvedDisputes: 0,
    }).tier,
    "legend"
  );
});

test("badge demotion below 4.5 pauses Top Rated", () => {
  const r = deriveBadgeTier({
    completedOrders: 60,
    rating: 4.4,
    isVerified: true,
    disputeCount: 0,
    previousTier: "top_rated",
  });
  assert.equal(r.demoted, true);
  assert.ok(r.tier !== "top_rated");
  assert.ok(r.demotionNotice);
  assert.ok(r.demotionNotice.includes("4.4"));
  assert.equal(BADGE_DEMOTION_FLOOR, 4.5);
});
