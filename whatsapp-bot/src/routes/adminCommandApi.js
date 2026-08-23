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
  getPlatformCommissions,
  pauseEscrowOrder,
  refundEscrowOrder,
  releaseEscrowOrder,
} from "../services/platform-command.js";
import { initiateSettlementB2C, markPayoutPaid } from "../services/settlements.js";
import { isB2CReady, b2cMeta } from "../services/daraja-mpesa.js";
import { markWithdrawalPaid, markWithdrawalPaidByOrderId } from "../services/seller-withdrawals.js";
import { config } from "../config.js";
import { updateOrderMeta } from "../services/orders.js";
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

/** POST /admin/command/escrow/:orderId/paid — mark queued / Ready payout sent by hand */
router.post("/escrow/:orderId/paid", (req, res) => {
  const id = String(req.params.orderId || "").trim();
  if (/^WD-\d{4}-\d+/i.test(id)) {
    const out = markWithdrawalPaid(id);
    if (out.error === "not_found") return res.status(404).json(out);
    return res.json({ ok: true, ...out, message: `Marked ${id} paid.` });
  }
  const entry = markPayoutPaid(id);
  if (!entry) return res.status(404).json({ error: "not_found", message: `No owed / queued payout for ${id}.` });
  try {
    updateOrderMeta(id, {
      payoutStatus: "paid",
      isPaidOut: true,
      paidOutAt: Date.now(),
      payoutRail: "admin",
    });
  } catch {
    /* ignore */
  }
  const done = markWithdrawalPaidByOrderId(id);
  res.json({
    ok: true,
    entry,
    withdrawal: done?.request || null,
    message: done?.ok
      ? `Marked ${id} paid — withdrawal ${done.request.id} closed.`
      : `Marked ${id} paid.`,
  });
});

/** POST /admin/command/escrow/:orderId/payb2c — Daraja B2C only when PAYSTACK_ONLY=false */
router.post("/escrow/:orderId/payb2c", async (req, res) => {
  if (config.paystack?.only !== false) {
    return res.status(409).json({
      error: "daraja_off",
      message:
        "Daraja B2C is off. Send M-Pesa by hand, then Mark paid (or WhatsApp #paid WD-…).",
    });
  }
  if (!isB2CReady()) {
    return res.status(503).json({
      error: "b2c_not_configured",
      message:
        "Set MPESA_INITIATOR_NAME + MPESA_SECURITY_CREDENTIAL (initiator DavidMuiruri) then restart the bot.",
      b2c: b2cMeta(),
    });
  }
  try {
    const result = await initiateSettlementB2C(req.params.orderId, {
      force: Boolean(req.body?.force),
    });
    if (result.error === "not_found") return res.status(404).json(result);
    if (result.error) return res.status(400).json(result);
    res.json({ ok: true, ...result, b2c: b2cMeta() });
  } catch (err) {
    res.status(500).json({ error: "payb2c_failed", message: err.message });
  }
});

/** GET /admin/command/hubs?days=30 */
router.get("/hubs", (req, res) => {
  const days = Number(req.query.days) || 30;
  res.json(getHubPerformanceStats({ days }));
});

/** GET /admin/command/commissions?days=30&status=all|earned|held|refunded */
router.get("/commissions", (req, res) => {
  const days = Number(req.query.days) || 30;
  const limit = Number(req.query.limit) || 80;
  const status = String(req.query.status || "all");
  res.json(getPlatformCommissions({ days, limit, status }));
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
