/**
 * Growth loops: Sokoni Points, Seller Power Board, Pamoja pools, rider quest.
 * Currently paused (Coming Soon) — flip GROWTH_FEATURES_LIVE when ready.
 */
import { Router } from "express";
import { getPointsBalance, redeemPoints } from "../services/sokoni-points.js";
import {
  POINTS_EARN,
  POINTS_REDEEM_THRESHOLD,
  POINTS_REDEEM_KES,
} from "../lib/sokoni-points.js";
import { buildSellerPowerBoard } from "../lib/seller-power-board.js";
import { getSellerRatingProfile } from "../services/rating-engine.js";
import { createPamojaPool, joinPamojaPool, getPamojaPool } from "../services/pamoja.js";
import { getRiderDailyQuest } from "../services/rider-daily-quest.js";
import {
  hasBuyerSessionContext,
  resolveAuthenticatedBuyerSocialContext,
} from "../services/buyer-social-auth.js";
import { resolveAuthenticatedSellerSocialContext } from "../services/seller-social-auth.js";
import { growthLive, GROWTH_COMING_SOON } from "../lib/growth-features.js";

const router = Router();

function hasSellerSessionContext(req) {
  const phone = req.body?.phone || req.query?.phone;
  const sessionToken =
    req.body?.sessionToken ||
    req.body?.verificationToken ||
    req.query?.sessionToken ||
    req.query?.verificationToken ||
    req.headers["x-seller-session"];
  return Boolean(phone && sessionToken);
}

async function resolveBuyerOrSeller(req) {
  if (hasSellerSessionContext(req)) {
    const seller = await resolveAuthenticatedSellerSocialContext(req);
    if (!seller.error && seller.sellerUserId) {
      return { role: "seller", userId: seller.sellerUserId, phone: seller.phone || "" };
    }
  }
  if (hasBuyerSessionContext(req)) {
    const buyer = await resolveAuthenticatedBuyerSocialContext(req);
    if (!buyer.error && buyer.buyerUserId) {
      return { role: "buyer", userId: buyer.buyerUserId, phone: buyer.phone || "" };
    }
    if (buyer.error) return { error: buyer.error, status: buyer.status || 401 };
  }
  return { error: "session_required", status: 401 };
}

function pausedPayload(extra = {}) {
  return {
    ...GROWTH_COMING_SOON,
    live: false,
    features: {
      points: false,
      powerBoard: false,
      pamoja: false,
      riderQuest: false,
    },
    ...extra,
  };
}

router.get("/status", (_req, res) => {
  res.json({
    ok: true,
    live: growthLive(),
    comingSoon: !growthLive(),
    message: growthLive()
      ? "Growth features are live."
      : "Coming soon — Points, Power Board & Pamoja are paused.",
    features: {
      points: growthLive(),
      powerBoard: growthLive(),
      pamoja: growthLive(),
      riderQuest: growthLive(),
    },
  });
});

router.get("/points/rates", (_req, res) => {
  if (!growthLive()) {
    return res.json(pausedPayload({ earn: POINTS_EARN, redeem: null }));
  }
  res.json({
    ok: true,
    live: true,
    earn: POINTS_EARN,
    redeem: {
      threshold: POINTS_REDEEM_THRESHOLD,
      kesPerBlock: POINTS_REDEEM_KES,
      example: "1000 points ≈ KES 100 marketplace credit",
    },
  });
});

router.get("/points/balance", async (req, res) => {
  if (!growthLive()) return res.json(pausedPayload());
  try {
    const auth = await resolveBuyerOrSeller(req);
    if (auth.error || !auth.userId) {
      return res.status(auth.status || 401).json({ ok: false, error: auth.error || "session_required" });
    }
    const subjectType = auth.role === "seller" ? "seller" : "buyer";
    const bal = await getPointsBalance(subjectType, auth.userId);
    res.json({
      ok: true,
      subjectType,
      subjectId: auth.userId,
      ...bal,
      redeemHint: "1000 points ≈ KES 100 credit",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "balance_failed" });
  }
});

router.post("/points/redeem", async (req, res) => {
  if (!growthLive()) return res.status(503).json(pausedPayload());
  try {
    const auth = await resolveBuyerOrSeller(req);
    if (auth.error || !auth.userId) {
      return res.status(auth.status || 401).json({ ok: false, error: auth.error || "session_required" });
    }
    const subjectType = auth.role === "seller" ? "seller" : "buyer";
    const out = await redeemPoints({ subjectType, subjectId: auth.userId });
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "redeem_failed" });
  }
});

router.get("/power-board/me", async (req, res) => {
  if (!growthLive()) {
    return res.json(
      pausedPayload({
        headline: "Seller Power Board",
        nextHint: "Coming soon — badge progress & Sokoni Points are paused for now.",
        progressPct: 0,
        checklist: [],
      })
    );
  }
  try {
    const seller = await resolveAuthenticatedSellerSocialContext(req);
    if (seller.error || !seller.sellerUserId) {
      return res
        .status(seller.status || 401)
        .json({ ok: false, error: seller.error || "session_required" });
    }
    const profile = await getSellerRatingProfile(seller.sellerUserId);
    const board = buildSellerPowerBoard({
      completedOrders: profile.completedOrders,
      avgRating: profile.avgRating,
      unrated: profile.unrated,
      isVerifiedStore: profile.isSellerVerified || profile.isVerifiedStore,
      isSellerVerified: profile.isSellerVerified,
      disputeCount: profile.disputeCount,
      unresolvedDisputes: profile.unresolvedDisputes,
      badgeTier: profile.badgeTier,
    });
    const points = await getPointsBalance("seller", seller.sellerUserId);
    res.json({ ok: true, sellerUserId: seller.sellerUserId, ...board, points });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "power_board_failed" });
  }
});

router.get("/power-board/:sellerId", async (req, res) => {
  if (!growthLive()) return res.json(pausedPayload());
  try {
    const id = Number(req.params.sellerId);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, error: "invalid_seller" });
    }
    const profile = await getSellerRatingProfile(id);
    const board = buildSellerPowerBoard({
      completedOrders: profile.completedOrders,
      avgRating: profile.avgRating,
      unrated: profile.unrated,
      isVerifiedStore: profile.isSellerVerified || profile.isVerifiedStore,
      disputeCount: profile.disputeCount,
      unresolvedDisputes: profile.unresolvedDisputes,
      badgeTier: profile.badgeTier,
    });
    res.json({ ok: true, sellerUserId: id, ...board });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "power_board_failed" });
  }
});

router.post("/pamoja", async (req, res) => {
  if (!growthLive()) return res.status(503).json(pausedPayload());
  try {
    const auth = await resolveBuyerOrSeller(req);
    if (auth.error || !auth.userId) {
      return res.status(auth.status || 401).json({ ok: false, error: auth.error || "session_required" });
    }
    const out = await createPamojaPool({
      productId: req.body?.productId,
      leaderUserId: auth.userId,
      leaderPhone: auth.phone || req.body?.phone || "",
      targetSize: req.body?.targetSize,
      discountPct: req.body?.discountPct,
      hoursOpen: req.body?.expiresHours || req.body?.hoursOpen || 2,
    });
    if (out.error || out.comingSoon) return res.status(out.comingSoon ? 503 : 400).json({ ok: false, ...out });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "pamoja_create_failed" });
  }
});

router.post("/pamoja/:code/join", async (req, res) => {
  if (!growthLive()) return res.status(503).json(pausedPayload());
  try {
    const auth = await resolveBuyerOrSeller(req);
    if (auth.error || !auth.userId) {
      return res.status(auth.status || 401).json({ ok: false, error: auth.error || "session_required" });
    }
    const out = await joinPamojaPool({
      code: req.params.code,
      userId: auth.userId,
      phone: auth.phone || req.body?.phone || "",
    });
    if (out.error || out.comingSoon) return res.status(out.comingSoon ? 503 : 400).json({ ok: false, ...out });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "pamoja_join_failed" });
  }
});

router.get("/pamoja/:code", async (req, res) => {
  if (!growthLive()) return res.status(503).json(pausedPayload());
  try {
    const out = await getPamojaPool(req.params.code);
    if (out.error) return res.status(404).json({ ok: false, ...out });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "pamoja_get_failed" });
  }
});

router.get("/rider-quest/:riderId", async (req, res) => {
  if (!growthLive()) return res.json(pausedPayload());
  try {
    const id = Number(req.params.riderId);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, error: "invalid_rider" });
    }
    const quest = await getRiderDailyQuest(id);
    res.json({ ok: true, quest });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "quest_failed" });
  }
});

export default router;
