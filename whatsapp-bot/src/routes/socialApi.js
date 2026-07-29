import { Router } from "express";
import {
  createOrderReview,
  createOffer,
  getDirectThread,
  getShopProfileByHandle,
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

const router = Router();

function hasSellerSessionContext(req, payload = req.body || {}) {
  return Boolean(
    payload?.phone ||
      payload?.sessionToken ||
      payload?.verificationToken ||
      req.query?.phone ||
      req.query?.sessionToken ||
      req.query?.verificationToken ||
      req.headers["x-seller-session"]
  );
}

function socialErrorStatus(error) {
  if (error === "database_not_configured") return 503;
  if (error === "forbidden_offer_action" || error === "seller_session_mismatch") return 403;
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
    const result = await toggleFollow(req.body || {});
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

/** GET /api/social/shop/:handle — storefront profile + active listings */
router.get("/shop/:handle", async (req, res) => {
  try {
    const result = await getShopProfileByHandle({
      handle: req.params.handle,
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

/** POST /api/social/offers/create — buyer makes/updates pending offer */
router.post("/offers/create", async (req, res) => {
  try {
    const result = await createOffer(req.body || {});
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

/** POST /api/social/chat/send — moderated in-app DM */
router.post("/chat/send", async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    const hasSellerContext = hasSellerSessionContext(req, payload);

    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }
      const requestedSenderId = Number(payload.senderUserId);
      if (Number.isInteger(requestedSenderId) && requestedSenderId > 0 && requestedSenderId !== auth.sellerUserId) {
        return res.status(403).json({
          error: "seller_session_mismatch",
          message: "Seller session does not match the sender profile in this request.",
        });
      }
      payload.senderUserId = auth.sellerUserId;
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
    if (hasSellerContext) {
      const auth = await resolveAuthenticatedSellerSocialContext(req);
      if (auth.error) {
        return res.status(auth.status || 403).json({
          error: auth.error,
          message: auth.message,
        });
      }

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
    const result = await createOrderReview(req.body || {});
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
