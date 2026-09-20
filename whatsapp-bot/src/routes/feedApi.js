import { Router } from "express";
import {
  logFeedEvent,
  getFeedEventStats,
  getProductDemandBatch,
  demandTags,
} from "../services/feed-events.js";
import {
  buildHomeFeed,
  buildFollowingFeed,
  feedMeta,
  refreshFeedCache,
} from "../services/feed-ranking.js";

const router = Router();

router.get("/meta", (_req, res) => {
  res.json({ ...feedMeta(), stats: getFeedEventStats() });
});

router.get("/home", async (req, res) => {
  try {
    const mode = String(req.query.mode || "explore").trim().toLowerCase();
    const sessionId = String(req.query.sessionId || "").trim();
    const saved = String(req.query.saved || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const viewerUserId = Number(req.query.viewerUserId || req.query.viewer || 0) || null;

    const feed =
      mode === "following"
        ? await buildFollowingFeed({ viewerUserId, limit: req.query.limit })
        : await buildHomeFeed({ sessionId, savedIds: saved });
    res.json({ feed, meta: feedMeta() });
  } catch (err) {
    console.error("[feed/home]", err.message);
    res.status(500).json({ error: "feed_failed" });
  }
});

router.post("/event", (req, res) => {
  const { sessionId, type, productId, category, query, meta } = req.body || {};
  const entry = logFeedEvent({ sessionId, type, productId, category, query, meta });
  if (!entry) return res.status(400).json({ error: "invalid_event" });
  res.status(201).json({ ok: true, event: { id: entry.id, type: entry.type } });
});

router.post("/refresh", async (_req, res) => {
  try {
    const cache = await refreshFeedCache();
    res.json({ ok: true, builtAt: cache.builtAt, counts: {
      trending: cache.trending.length,
      under5000: cache.under5000.length,
      preloved: cache.preloved.length,
    }});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/feed/demand?ids=a,b,c
 * Urgency signals for product cards. Public and read-only -- it exposes counts,
 * never session ids. Capped at 60 ids so a grid cannot walk the whole catalog.
 */
router.get("/demand", (req, res) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 60);
    if (!ids.length) return res.json({ demand: {} });

    const raw = getProductDemandBatch(ids);
    const demand = {};
    for (const [id, d] of Object.entries(raw)) {
      const tags = demandTags(d);
      // Only ship rows that actually have something to say.
      if (tags.length) demand[id] = { ...d, tags };
    }
    res.json({ demand });
  } catch (err) {
    console.warn("[feed/demand]", err.message);
    res.status(500).json({ error: "demand_failed" });
  }
});

export default router;
