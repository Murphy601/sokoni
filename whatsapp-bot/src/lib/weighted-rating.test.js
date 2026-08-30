import test from "node:test";
import assert from "node:assert/strict";
import {
  pushStarToPool,
  pushDeltaToPool,
  scoreFromPool,
  purgePoolEntry,
  deriveBadgeTier,
  buildAdminOverridePool,
  clampRating,
  RATING_DELTAS,
  BADGE_DEMOTION_FLOOR,
  MIN_PUBLIC_REVIEWS,
  ROLLING_WINDOW,
  VERIFIED_MIN_RATING,
} from "./weighted-rating.js";

test("empty pool is 5.0 UNRATED", () => {
  const s = scoreFromPool([]);
  assert.equal(s.rating, 5);
  assert.equal(s.unrated, true);
  assert.equal(s.displayLabel, "UNRATED");
});

test("50×5 then one 1★ → 4.92", () => {
  let pool = [];
  for (let i = 0; i < 50; i++) {
    const r = pushStarToPool(pool, 5);
    pool = r.pool;
  }
  const next = pushStarToPool(pool, 1);
  assert.equal(next.rating, 4.92);
  assert.equal(next.buyerReviewCount, 51);
  assert.equal(next.unrated, false);
});

test("UNRATED until 5 buyer stars", () => {
  let pool = [];
  for (let i = 0; i < MIN_PUBLIC_REVIEWS - 1; i++) {
    pool = pushStarToPool(pool, 5).pool;
  }
  assert.equal(scoreFromPool(pool).unrated, true);
  pool = pushStarToPool(pool, 5).pool;
  assert.equal(scoreFromPool(pool).unrated, false);
});

test("rolling window keeps last 100 only", () => {
  let pool = [];
  for (let i = 0; i < 120; i++) {
    pool = pushStarToPool(pool, i < 20 ? 1 : 5).pool;
  }
  assert.equal(pool.length, ROLLING_WINDOW);
  // First 20 ones dropped — remaining all 5s
  assert.equal(scoreFromPool(pool).rating, 5);
});

test("penalty pushes synthetic entry into pool", () => {
  let pool = [];
  for (let i = 0; i < 10; i++) pool = pushStarToPool(pool, 5).pool;
  const before = scoreFromPool(pool).rating;
  const after = pushDeltaToPool(pool, RATING_DELTAS.BUYER_WON_DISPUTE);
  assert.ok(after.rating < before);
  assert.equal(after.pool.length, 11);
});

test("purge removes unfair entry and recalcs", () => {
  let pool = pushStarToPool([], 5).pool;
  pool = pushStarToPool(pool, 1, { id: "bad_1" }).pool;
  const purged = purgePoolEntry(pool, "bad_1");
  assert.equal(purged.rating, 5);
  assert.equal(purged.buyerReviewCount, 1);
});

test("clampRating bounds", () => {
  assert.equal(clampRating(-1), 0);
  assert.equal(clampRating(9), 5);
});

test("badge Verified needs ≥4.2", () => {
  assert.equal(VERIFIED_MIN_RATING, 4.2);
  assert.equal(
    deriveBadgeTier({ completedOrders: 10, rating: 4.1, isVerified: true }).tier,
    "newbie"
  );
  assert.equal(
    deriveBadgeTier({ completedOrders: 10, rating: 4.2, isVerified: true }).tier,
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

test("UNRATED profile cannot unlock Verified via grace 5.0 alone", () => {
  const r = deriveBadgeTier({
    completedOrders: 10,
    rating: 5,
    unrated: true,
    isVerified: true,
  });
  assert.equal(r.tier, "newbie");
});

test("badge demotion below 4.5", () => {
  const r = deriveBadgeTier({
    completedOrders: 60,
    rating: 4.4,
    isVerified: true,
    disputeCount: 0,
    previousTier: "top_rated",
  });
  assert.equal(r.demoted, true);
  assert.ok(r.demotionNotice.includes("4.4"));
  assert.ok(r.demotionNotice.includes("Top Rated"));
  assert.equal(BADGE_DEMOTION_FLOOR, 4.5);
});

test("Boss admin_set-only pool is public (legacy override)", () => {
  const scored = scoreFromPool([{ v: 4.8, kind: "admin_set", at: "2026-01-01" }]);
  assert.equal(scored.unrated, false);
  assert.equal(scored.rating, 4.8);
  assert.ok(scored.buyerReviewCount >= MIN_PUBLIC_REVIEWS);
  assert.equal(scored.displayLabel, "4.80");
});

test("buildAdminOverridePool unlocks public ★ score", () => {
  const pool = buildAdminOverridePool(4.8);
  const scored = scoreFromPool(pool);
  assert.equal(scored.unrated, false);
  assert.equal(scored.rating, 4.8);
  assert.ok(scored.buyerReviewCount >= MIN_PUBLIC_REVIEWS);
  assert.ok(pool.some((e) => e.kind === "admin_set"));
  assert.ok(pool.filter((e) => e.kind === "star").length >= MIN_PUBLIC_REVIEWS);
});
