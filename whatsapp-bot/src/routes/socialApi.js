import { Router } from "express";
import {
  createOrderReview,
  createOffer,
  getAcceptedOfferForCheckout,
  getDirectThread,
  getShopProfileByHandle,
  listSellerHandledOfferQueueEvents,
  listSellerHandledOfferQueue,
  listSellerReviews,
  getUserSocialStats,
  listOffers,
  listBuyerSocialActivity,
  listSellerSocialActivity,
  listUserFollowConnections,
  getUserNotifyPrefs,
  updateUserNotifyPrefs,
  resetSellerHandledOfferQueue,
  respondToOffer,
  sendOfferReminder,
  setSellerHandledOfferQueueState,
  sendDirectMessage,
  toggleFollow,
  updateUserShopProfile,
} from "../db/repositories/social.js";
import { resolveAuthenticatedSellerSocialContext } from "../services/seller-social-auth.js";
import { updatePeerSellerProfile } from "../services/suppliers.js";
import {
  notifyBuyerOfferResponse,
  notifySellerNewFollower,
} from "../services/social-notifications.js";
import {
  applyBuyerIdentityAuth,
  hasBuyerSessionContext,
  resolveAuthenticatedBuyerSocialContext,
} from "../services/buyer-social-auth.js";

const router = Router();

function hasSellerSessionContext(req, payload = req.body || {}) {
  const phone = payload?.phone || req.query?.phone;
  const sessionToken =
    payload?.sessionToken ||
    payload?.verificationToken ||
    req.query?.sessionToken ||
    req.query?.verificationToken ||
    req.headers["x-seller-session"];
  // Require phone + token so buyer sessions (same field names) are not misrouted
  // through seller auth on chat/offers endpoints.
  return Boolean(phone && sessionToken);
}

function socialErrorStatus(error) {
  if (error === "database_not_configured") return 503;
  if (
    error === "forbidden_offer_action" ||
    error === "forbidden_offer_checkout" ||
    error === "seller_session_mismatch" ||
    error === "buyer_session_mismatch"
  ) {
    return 403;
  }
  if (error === "session_required" || error === "session_invalid" || error === "session_expired") return 401;
  if (error === "reminder_cooldown_active") return 429;
  if (
    error === "offer_not_pending" ||
    error === "offer_not_accepted" ||
    error === "offer_expired" ||
    error === "product_unavailable" ||
    error === "offer_above_list" ||
    error === "offer_too_low_for_shipping" ||
    error === "review_exists"
  ) {
    return 409;
  }
  if (
    error === "user_not_found" ||
    error === "buyer_not_found" ||
    error === "seller_not_found" ||
    error === "follower_not_found" ||
    error === "following_not_found" ||
    error === "product_not_found" ||
    error === "offer_not_found" ||
    error === "order_not_found" ||
    error === "shop_not_found" ||
    error === "sender_not_found" ||
    error === "receiver_not_found"
  ) {
    return 404;
  }
  if (error === "handle_taken") return 409;
  return 400;
}

/** POST /api/social/follow — toggle follow relation */
router.post("/follow", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "followerUserId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const result = await toggleFollow(gated.payload || {});
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    if (result.created) {
      void notifySellerNewFollower({
        followerUserId: result.followerUserId,
        followingUserId: result.followingUserId,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/users/:userId/stats — social counters for storefront */
router.get("/users/:userId/stats", async (req, res) => {
  try {
    const result = await getUserSocialStats(req.params.userId);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json({ stats: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/users/:userId/followers — people who follow this user */
router.get("/users/:userId/followers", async (req, res) => {
  try {
    const result = await listUserFollowConnections({
      userId: req.params.userId,
      direction: "followers",
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/users/:userId/following — people this user follows */
router.get("/users/:userId/following", async (req, res) => {
  try {
    const result = await listUserFollowConnections({
      userId: req.params.userId,
      direction: "following",
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/social/shop/profile — seller updates storefront identity fields */
router.patch("/shop/profile", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const result = await updateUserShopProfile({
      userId: auth.sellerUserId,
      sellerId: auth.sellerId,
      handle: req.body?.handle ?? req.body?.shopHandle,
      shopName: req.body?.shopName ?? req.body?.businessName,
      bio: req.body?.bio,
      avatarUrl: req.body?.avatarUrl,
      location: req.body?.location ?? req.body?.city,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }

    // Optional notify prefs on the same save.
    let notifyPrefs = null;
    if (
      req.body?.socialWaNotify !== undefined ||
      req.body?.socialWaNotifyFollows !== undefined ||
      req.body?.socialWaNotifyLikes !== undefined ||
      req.body?.socialWaNotifyOffers !== undefined
    ) {
      notifyPrefs = await updateUserNotifyPrefs({
        userId: auth.sellerUserId,
        socialWaNotify: req.body.socialWaNotify,
        socialWaNotifyFollows: req.body.socialWaNotifyFollows,
        socialWaNotifyLikes: req.body.socialWaNotifyLikes,
        socialWaNotifyOffers: req.body.socialWaNotifyOffers,
      });
    } else {
      notifyPrefs = await getUserNotifyPrefs({ userId: auth.sellerUserId });
    }

    // Keep JSON supplier handle/name in sync so seller session auth still resolves.
    updatePeerSellerProfile(auth.phone, {
      shopName: result.shop?.shopName,
      shopHandle: result.shop?.handle,
      city: result.shop?.location,
    });

    const prefsOk = notifyPrefs && !notifyPrefs.error;
    res.json({
      success: true,
      shop: {
        ...result.shop,
        socialWaNotify: prefsOk ? notifyPrefs.socialWaNotify : result.shop?.socialWaNotify !== false,
        socialWaNotifyFollows: prefsOk ? notifyPrefs.socialWaNotifyFollows : true,
        socialWaNotifyLikes: prefsOk ? notifyPrefs.socialWaNotifyLikes : true,
        socialWaNotifyOffers: prefsOk ? notifyPrefs.socialWaNotifyOffers : true,
      },
      message: "Shop profile updated.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Soft-resolve buyer or seller session for notify prefs.
 * Prefer seller when seller context is present and valid; else buyer.
 */
async function resolveNotifyPrefsUser(req) {
  if (hasSellerSessionContext(req, req.body || req.query || {})) {
    const seller = await resolveAuthenticatedSellerSocialContext(req);
    if (seller.ok) {
      return { ok: true, userId: seller.sellerUserId, role: "seller" };
    }
    if (!isAmbiguousSessionAuthError(seller.error)) {
      return seller;
    }
  }
  if (hasBuyerSessionContext(req, req.body || req.query || {})) {
    const buyer = await resolveAuthenticatedBuyerSocialContext(req);
    if (buyer.error) return buyer;
    return { ok: true, userId: buyer.buyerUserId, role: "buyer" };
  }
  return {
    error: "session_required",
    message: "Sign in with WhatsApp to manage notification preferences.",
    status: 401,
  };
}

/** GET /api/social/notify-prefs — buyer or seller WhatsApp social ping preference */
router.get("/notify-prefs", async (req, res) => {
  try {
    const auth = await resolveNotifyPrefsUser(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }
    const result = await getUserNotifyPrefs({ userId: auth.userId });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json({ ...result, role: auth.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/social/notify-prefs — mute/unmute WhatsApp social pings */
router.patch("/notify-prefs", async (req, res) => {
  try {
    const auth = await resolveNotifyPrefsUser(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }
    const result = await updateUserNotifyPrefs({
      userId: auth.userId,
      socialWaNotify: req.body?.socialWaNotify,
      socialWaNotifyFollows: req.body?.socialWaNotifyFollows,
      socialWaNotifyLikes: req.body?.socialWaNotifyLikes,
      socialWaNotifyOffers: req.body?.socialWaNotifyOffers,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json({ ...result, role: auth.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/activity — seller feed: new followers + likes on your items */
router.get("/activity", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requested = Number(req.query.userId);
    if (
      Number.isInteger(requested) &&
      requested > 0 &&
      requested !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the activity profile in this request.",
      });
    }

    const result = await listSellerSocialActivity({
      sellerUserId: auth.sellerUserId,
      limit: req.query.limit,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/buyer/activity — buyer feed: offer replies, follows, likes */
router.get("/buyer/activity", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedBuyerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requested = Number(req.query.userId);
    if (
      Number.isInteger(requested) &&
      requested > 0 &&
      requested !== auth.buyerUserId
    ) {
      return res.status(403).json({
        error: "buyer_session_mismatch",
        message: "Buyer session does not match the activity profile in this request.",
      });
    }

    const result = await listBuyerSocialActivity({
      buyerUserId: auth.buyerUserId,
      limit: req.query.limit,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseOptionalViewerUserId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Soft-resolve viewer for public shop reads.
 * Prefer buyer session when present; fall back to ?viewer= / ?viewerUserId=.
 * Invalid sessions do not fail the public GET — viewer state is simply omitted.
 */
async function resolveOptionalShopViewerUserId(req) {
  if (hasBuyerSessionContext(req, req.query || {})) {
    const auth = await resolveAuthenticatedBuyerSocialContext(req);
    if (auth.ok) return auth.buyerUserId;
  }
  return (
    parseOptionalViewerUserId(req.query?.viewer) ||
    parseOptionalViewerUserId(req.query?.viewerUserId) ||
    null
  );
}

/** GET /api/social/shop/:handle — storefront profile + active listings */
router.get("/shop/:handle", async (req, res) => {
  try {
    const viewerUserId = await resolveOptionalShopViewerUserId(req);
    const result = await getShopProfileByHandle({
      handle: req.params.handle,
      limit: req.query.limit,
      offset: req.query.offset,
      viewerUserId,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/social/offers/create — buyer makes/updates pending offer */
router.post("/offers/create", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "buyerUserId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const result = await createOffer(gated.payload || {});
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/social/offers/:offerId/checkout
 * Buyer-only preview of agreed-price fee breakdown for an accepted offer.
 * amount_kes is negotiated buyer all-in (same semantics as listing price_kes).
 */
router.get("/offers/:offerId/checkout", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(
      req,
      { ...(req.query || {}), buyerUserId: req.query?.buyerUserId },
      "buyerUserId"
    );
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const result = await getAcceptedOfferForCheckout({
      offerId: req.params.offerId,
      buyerUserId: gated.payload?.buyerUserId,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/social/offers/:offerId/respond — seller accepts/declines */
router.post("/offers/:offerId/respond", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.body?.sellerUserId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await respondToOffer({
      offerId: req.params.offerId,
      sellerUserId: auth.sellerUserId,
      action: req.body?.action,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    if (result.offer) {
      void notifyBuyerOfferResponse({ offer: result.offer });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/social/offers/:offerId/remind — seller reminder with cooldown */
router.post("/offers/:offerId/remind", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.body?.sellerUserId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await sendOfferReminder({
      offerId: req.params.offerId,
      sellerUserId: auth.sellerUserId,
      cooldownSeconds: req.body?.cooldownSeconds,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
        cooldownMsRemaining: result.cooldownMsRemaining,
        cooldownSecondsRemaining: result.cooldownSecondsRemaining,
        lastReminderAt: result.lastReminderAt,
        cooldownEndsAt: result.cooldownEndsAt,
      });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/offers/handled?offerIds=12,18 */
router.get("/offers/handled", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.query.userId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await listSellerHandledOfferQueue({
      sellerUserId: auth.sellerUserId,
      offerIds: req.query.offerIds,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/offers/handled/events?offerId=12&action=handled */
router.get("/offers/handled/events", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.query.userId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await listSellerHandledOfferQueueEvents({
      sellerUserId: auth.sellerUserId,
      offerId: req.query.offerId,
      action: req.query.action,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/social/offers/handled/reset — clear seller handled queue */
router.post("/offers/handled/reset", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.body?.sellerUserId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await resetSellerHandledOfferQueue({
      sellerUserId: auth.sellerUserId,
      source: req.body?.source,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/social/offers/:offerId/handled — set seller handled queue state */
router.post("/offers/:offerId/handled", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }

    const requestedSellerUserId = Number(req.body?.sellerUserId);
    if (
      Number.isInteger(requestedSellerUserId) &&
      requestedSellerUserId > 0 &&
      requestedSellerUserId !== auth.sellerUserId
    ) {
      return res.status(403).json({
        error: "seller_session_mismatch",
        message: "Seller session does not match the seller profile in this request.",
      });
    }

    const result = await setSellerHandledOfferQueueState({
      offerId: req.params.offerId,
      sellerUserId: auth.sellerUserId,
      handled: req.body?.handled,
      source: req.body?.source,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/offers?userId=1&role=buyer|seller&status=pending */
router.get("/offers", async (req, res) => {
  try {
    const normalizedRole = String(req.query.role || "buyer")
      .trim()
      .toLowerCase();

    let userId = req.query.userId;
    if (normalizedRole === "seller") {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      const requestedSellerUserId = Number(req.query.userId);
      if (
        Number.isInteger(requestedSellerUserId) &&
        requestedSellerUserId > 0 &&
        requestedSellerUserId !== auth.sellerUserId
      ) {
        return res.status(403).json({
          error: "seller_session_mismatch",
          message: "Seller session does not match the seller profile in this request.",
        });
      }
      userId = auth.sellerUserId;
    } else if (hasBuyerSessionContext(req, req.query || {})) {
      const auth = await resolveAuthenticatedBuyerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      const requestedBuyerUserId = Number(req.query.userId);
      if (
        Number.isInteger(requestedBuyerUserId) &&
        requestedBuyerUserId > 0 &&
        requestedBuyerUserId !== auth.buyerUserId
      ) {
        return res.status(403).json({
          error: "buyer_session_mismatch",
          message: "Buyer session does not match the buyer profile in this request.",
        });
      }
      userId = auth.buyerUserId;
    }

    const result = await listOffers({
      userId,
      role: req.query.role,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function isAmbiguousSessionAuthError(error) {
  return (
    error === "session_required" ||
    error === "session_invalid" ||
    error === "session_expired" ||
    error === "invalid_phone"
  );
}

/** POST /api/social/chat/send — moderated in-app DM */
router.post("/chat/send", async (req, res) => {
  try {
    let payload = { ...(req.body || {}) };
    const hasSellerContext = hasSellerSessionContext(req, payload);
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requestedSenderId = Number(payload.senderUserId);
        if (Number.isInteger(requestedSenderId) && requestedSenderId > 0 && requestedSenderId !== auth.sellerUserId) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the sender profile in this request.",
          });
        }
        payload.senderUserId = auth.sellerUserId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        // Valid-looking seller session that failed profile linkage — do not fall through.
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      // session_invalid/expired: may be a buyer OTP session using the same field names.
    }

    if (!usedSellerIdentity) {
      const gated = await applyBuyerIdentityAuth(req, payload, "senderUserId");
      if (gated.error) {
        return res.status(gated.status || socialErrorStatus(gated.error)).json({
          error: gated.error,
          message: gated.message,
        });
      }
      payload = gated.payload || payload;
    }

    const result = await sendDirectMessage(payload);
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/chat/thread?userAId=1&userBId=2 */
router.get("/chat/thread", async (req, res) => {
  try {
    const hasSellerContext = hasSellerSessionContext(req, req.query || {});
    let userAId = req.query.userAId;
    let userBId = req.query.userBId;
    let usedSellerIdentity = false;

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.ok) {
        const requestedUserA = Number(req.query.userAId);
        const requestedUserB = Number(req.query.userBId);
        const matchesA = Number.isInteger(requestedUserA) && requestedUserA > 0 && requestedUserA === auth.sellerUserId;
        const matchesB = Number.isInteger(requestedUserB) && requestedUserB > 0 && requestedUserB === auth.sellerUserId;
        if (!matchesA && !matchesB) {
          return res.status(403).json({
            error: "seller_session_mismatch",
            message: "Seller session does not match the chat thread participants in this request.",
          });
        }

        userAId = matchesA ? auth.sellerUserId : userAId;
        userBId = matchesB ? auth.sellerUserId : userBId;
        usedSellerIdentity = true;
      } else if (!isAmbiguousSessionAuthError(auth.error)) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
    }

    if (!usedSellerIdentity && hasBuyerSessionContext(req, req.query || {})) {
      const auth = await resolveAuthenticatedBuyerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      const requestedUserA = Number(req.query.userAId);
      const requestedUserB = Number(req.query.userBId);
      const matchesA = Number.isInteger(requestedUserA) && requestedUserA > 0 && requestedUserA === auth.buyerUserId;
      const matchesB = Number.isInteger(requestedUserB) && requestedUserB > 0 && requestedUserB === auth.buyerUserId;
      if (!matchesA && !matchesB) {
        return res.status(403).json({
          error: "buyer_session_mismatch",
          message: "Buyer session does not match the chat thread participants in this request.",
        });
      }
      userAId = matchesA ? auth.buyerUserId : userAId;
      userBId = matchesB ? auth.buyerUserId : userBId;
    }

    const result = await getDirectThread({
      userAId,
      userBId,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/social/reviews/create — review only after delivered/completed order */
router.post("/reviews/create", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "buyerUserId");
    if (gated.error) {
      return res.status(gated.status || socialErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const result = await createOrderReview(gated.payload || {});
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/social/reviews/seller/:sellerUserId */
router.get("/reviews/seller/:sellerUserId", async (req, res) => {
  try {
    const result = await listSellerReviews({
      sellerUserId: req.params.sellerUserId,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    if (result.error) {
      return res.status(socialErrorStatus(result.error)).json({
        error: result.error,
        message: result.message,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
