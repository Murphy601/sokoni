import { Router } from "express";
import {
  createOrderReview,
  createOffer,
  getDirectThread,
  getShopProfileByHandle,
  listSellerHandledOfferQueueEvents,
  listSellerHandledOfferQueue,
  listSellerReviews,
  getUserSocialStats,
  listOffers,
  resetSellerHandledOfferQueue,
  respondToOffer,
  sendOfferReminder,
  setSellerHandledOfferQueueState,
  sendDirectMessage,
  toggleFollow,
} from "../db/repositories/social.js";
import { resolveAuthenticatedSellerSocialContext } from "../services/seller-social-auth.js";
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
