import { Router } from "express";
import {
  createOffer,
  getDirectThread,
  getUserSocialStats,
  listOffers,
  respondToOffer,
  sendDirectMessage,
  toggleFollow,
} from "../db/repositories/social.js";

const router = Router();

function socialErrorStatus(error) {
  if (error === "database_not_configured") return 503;
  if (
    error === "user_not_found" ||
    error === "buyer_not_found" ||
    error === "seller_not_found" ||
    error === "follower_not_found" ||
    error === "following_not_found" ||
    error === "product_not_found" ||
    error === "offer_not_found" ||
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
    const result = await respondToOffer({
      offerId: req.params.offerId,
      sellerUserId: req.body?.sellerUserId,
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

/** GET /api/social/offers?userId=1&role=buyer|seller&status=pending */
router.get("/offers", async (req, res) => {
  try {
    const result = await listOffers({
      userId: req.query.userId,
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
    const result = await sendDirectMessage(req.body || {});
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
    const result = await getDirectThread({
      userAId: req.query.userAId,
      userBId: req.query.userBId,
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
