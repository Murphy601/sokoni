import { Router } from "express";
import { getUserSocialStats, toggleFollow } from "../db/repositories/social.js";

const router = Router();

function socialErrorStatus(error) {
  if (error === "database_not_configured") return 503;
  if (
    error === "user_not_found" ||
    error === "follower_not_found" ||
    error === "following_not_found"
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

export default router;
