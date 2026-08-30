import test from "node:test";
import assert from "node:assert/strict";
import {
  POINTS_EARN,
  POINTS_REDEEM_THRESHOLD,
  POINTS_REDEEM_KES,
  pointsToKes,
  redeemBlocks,
} from "./sokoni-points.js";
import { buildSellerPowerBoard } from "./seller-power-board.js";
import { deriveBadgeTier } from "./weighted-rating.js";
import { normalizeMasterCommand } from "../services/admin-override.js";

test("points economy: 1000 pts ≈ KES 100", () => {
  assert.equal(POINTS_REDEEM_THRESHOLD, 1000);
  assert.equal(POINTS_REDEEM_KES, 100);
  assert.equal(pointsToKes(1000), 100);
  assert.equal(pointsToKes(2500), 250);
  const plan = redeemBlocks(2450);
  assert.equal(plan.blocks, 2);
  assert.equal(plan.kesCredit, 200);
  assert.equal(plan.remainder, 450);
});

test("earn rates are low but promising", () => {
  assert.ok(POINTS_EARN.BUYER_ORDER_COMPLETE <= 12);
  assert.ok(POINTS_EARN.SELLER_ORDER_COMPLETE <= 15);
  assert.ok(POINTS_EARN.RIDER_DELIVERY <= 8);
  assert.equal(POINTS_EARN.RIDER_DAILY_QUEST, 40);
  assert.ok(POINTS_EARN.PAMOJA_JOIN <= 8);
});

test("newbie verified store shows trust chip + New Store", () => {
  const r = deriveBadgeTier({
    completedOrders: 0,
    rating: 5,
    unrated: true,
    isVerified: true,
  });
  assert.equal(r.tier, "newbie");
  assert.ok(r.badges.some((b) => b.id === "verified_store" && /VERIFIED STORE/.test(b.label)));
  assert.ok(r.badges.some((b) => b.id === "newbie" && /New Store|🐣/.test(b.label)));
});

test("emoji performance tiers", () => {
  const top = deriveBadgeTier({
    completedOrders: 50,
    rating: 4.8,
    isVerified: true,
    disputeCount: 0,
  });
  assert.equal(top.tier, "top_rated");
  assert.ok(top.badges[0].id === "verified_store");
  assert.ok(top.badges.some((b) => b.emoji === "🌟" || /Top Rated/.test(b.label)));

  const legend = deriveBadgeTier({
    completedOrders: 200,
    rating: 4.95,
    isVerified: true,
    unresolvedDisputes: 0,
  });
  assert.equal(legend.tier, "legend");
  assert.ok(legend.badges.some((b) => b.emoji === "👑" || /Legend/.test(b.label)));
});

test("power board progress toward Rising Merchant", () => {
  const board = buildSellerPowerBoard({
    completedOrders: 4,
    avgRating: 4.5,
    unrated: false,
    isVerifiedStore: false,
    badgeTier: "newbie",
  });
  assert.equal(board.currentTier, "newbie");
  assert.equal(board.nextTier, "rising");
  assert.ok(board.checklist.some((c) => c.id === "verified_store" && !c.done));
  assert.ok(board.progressPct < 100);
  assert.ok(/VERIFIED STORE|points/i.test(board.pointsNote + board.nextHint));
});

test("VERIFY STORE normalizes like VERIFY SHOP", () => {
  assert.equal(normalizeMasterCommand("VERIFY STORE @Adiv's thrift"), "VERIFY_SHOP Adiv's thrift");
  assert.equal(normalizeMasterCommand("verify shop @nairobi_kicks"), "VERIFY_SHOP nairobi_kicks");
});
