/**
 * Admin Command Center — Platform Manager APIs.
 * Mounted at /admin/command (requireAdminToken).
 */
import { Router } from "express";
import { requireAdminToken } from "../lib/admin-auth.js";
import {
  getPlatformCommandDashboard,
  getEscrowHoldingTank,
  getHubPerformanceStats,
  pauseEscrowOrder,
  refundEscrowOrder,
  releaseEscrowOrder,
} from "../services/platform-command.js";
import { listAdminDisputes, resolveDispute } from "../services/disputes.js";
import { smartSearch, smartSuggest } from "../services/smart-search.js";

const router = Router();
router.use(requireAdminToken);

/** GET /admin/command/dashboard */
router.get("/dashboard", async (_req, res) => {
  try {
    res.json(await getPlatformCommandDashboard());
  } catch (err) {
    res.status(500).json({ error: "dashboard_failed", message: err.message });
  }
});

/** GET /admin/command/escrow */
router.get("/escrow", (req, res) => {
  const limit = Number(req.query.limit) || 80;
  res.json(getEscrowHoldingTank({ limit }));
});

/** POST /admin/command/escrow/:orderId/pause */
router.post("/escrow/:orderId/pause", (req, res) => {
  const result = pauseEscrowOrder(req.params.orderId, {
    reason: req.body?.reason,
    adminLabel: req.body?.adminLabel || "admin-command",
  });
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

/** POST /admin/command/escrow/:orderId/refund */
router.post("/escrow/:orderId/refund", (req, res) => {
  const result = refundEscrowOrder(req.params.orderId, {
    reason: req.body?.reason,
    adminLabel: req.body?.adminLabel || "admin-command",
  });
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

/** POST /admin/command/escrow/:orderId/release */
router.post("/escrow/:orderId/release", (req, res) => {
  const result = releaseEscrowOrder(req.params.orderId, {
    reason: req.body?.reason,
    adminLabel: req.body?.adminLabel || "admin-command",
  });
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

/** GET /admin/command/hubs?days=30 */
router.get("/hubs", (req, res) => {
  const days = Number(req.query.days) || 30;
  res.json(getHubPerformanceStats({ days }));
});

/** GET /admin/command/disputes?status=open */
router.get("/disputes", async (req, res) => {
  const result = await listAdminDisputes({
    status: req.query.status || "open",
    limit: Number(req.query.limit) || 40,
  });
  if (result.error === "database_not_configured") {
    return res.status(503).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /admin/command/disputes/:id/resolve */
router.post("/disputes/:id/resolve", async (req, res) => {
  const result = await resolveDispute({
    disputeId: req.params.id,
    resolution: req.body?.resolution,
    notes: req.body?.notes,
    adminLabel: req.body?.adminLabel || "admin-command",
  });
  if (result.error === "database_not_configured") return res.status(503).json(result);
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** GET /admin/command/search?q= — smart search preview for admins */
router.get("/search", async (req, res) => {
  const q = String(req.query.q || req.query.query || "").trim();
  if (!q) return res.status(400).json({ error: "missing_query", message: "Pass ?q=" });
  try {
    const result = await smartSearch({
      q,
      limit: Number(req.query.limit) || 12,
      browseCategory: req.query.browse || null,
      browseSubCategory: req.query.browseSub || null,
      maxPriceKes: req.query.maxPriceKes != null ? Number(req.query.maxPriceKes) : null,
    });
    res.json({
      ...result,
      products: (result.products || []).map((p) => ({
        id: p.id,
        name: p.name,
        priceKes: p.priceKes,
        browseCategory: p.browseCategory,
        browseSubCategory: p.browseSubCategory,
        inStock: p.inStock !== false,
        imageUrl: p.imageUrl,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "search_failed", message: err.message });
  }
});

/** GET /admin/command/suggest?q= */
router.get("/suggest", async (req, res) => {
  res.json(await smartSuggest(String(req.query.q || ""), { limit: Number(req.query.limit) || 8 }));
});

export default router;
