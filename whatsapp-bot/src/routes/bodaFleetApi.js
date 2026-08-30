/**
 * Sokoni vetted boda fleet API.
 * Seller: POST /api/seller/onboard/boda/request (mounted from seller onboard)
 * Admin:  /api/admin/boda/*
 */
import { Router } from "express";
import { requireAdminToken } from "../lib/admin-auth.js";
import {
  upsertRiderProfile,
  setRiderVerificationStatus,
  listRiders,
  requestBodaDispatch,
  bodaSupportSummary,
  getOpenDispatchForOrder,
} from "../services/boda-fleet.js";
import { sellerSessionFromReq } from "../services/seller-verification.js";

export const sellerBodaRouter = Router();

/** POST /api/seller/onboard/boda/request */
sellerBodaRouter.post("/request", async (req, res) => {
  const {
    phone,
    orderId,
    zone,
    pickupAddress,
    deliveryAddress,
    deliveryFeeKes,
  } = req.body || {};
  const result = await requestBodaDispatch({
    phone,
    sessionToken: sellerSessionFromReq(req),
    orderId,
    zone,
    pickupAddress,
    deliveryAddress,
    deliveryFeeKes,
  });
  if (
    result.error === "session_required" ||
    result.error === "session_invalid" ||
    result.error === "session_expired"
  ) {
    return res.status(401).json(result);
  }
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error === "forbidden" || result.error === "support_hold") {
    return res.status(403).json(result);
  }
  if (result.error === "platform_assigns_riders") {
    return res.status(200).json({ ...result, ok: false });
  }
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** GET /api/seller/onboard/boda/status?orderId= */
sellerBodaRouter.get("/status", async (req, res) => {
  const orderId = String(req.query.orderId || "");
  const dispatch = await getOpenDispatchForOrder(orderId);
  res.json({ ok: true, dispatch, summary: bodaSupportSummary() });
});

export const adminBodaRouter = Router();
adminBodaRouter.use(requireAdminToken);

adminBodaRouter.get("/riders", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const result = await listRiders({
      zone: req.query.zone,
      status: req.query.status,
      limit: req.query.limit,
      q: req.query.q || req.query.phone || req.query.search,
    });
    if (result.error === "database_not_configured") return res.status(503).json(result);
    if (result.error === "list_failed") return res.status(500).json(result);
    res.json(result);
  } catch (err) {
    console.error("[admin/boda] list riders failed:", err?.message || err);
    return res.status(500).json({
      error: "list_failed",
      message: err?.message || "Could not list riders.",
      riders: [],
    });
  }
});

adminBodaRouter.post("/riders", async (req, res) => {
  const result = await upsertRiderProfile(req.body || {});
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

adminBodaRouter.post("/riders/:id/verify", async (req, res) => {
  try {
    const result = await setRiderVerificationStatus(req.params.id, req.body?.status || "VERIFIED", {
      reason: req.body?.reason || "",
    });
    if (result.error === "not_found") return res.status(404).json(result);
    if (result.error === "database_not_configured") return res.status(503).json(result);
    if (result.error === "verify_failed") return res.status(500).json(result);
    if (result.error) return res.status(400).json(result);
    // DB already updated; WhatsApp notify is async inside the service.
    console.log(
      `[admin/boda] verify #${result.rider?.id} → ${result.rider?.verificationStatus} phone=${result.rider?.phone}`
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json(result);
  } catch (err) {
    console.error("[admin/boda] verify failed:", err?.message || err);
    return res.status(500).json({
      error: "verify_failed",
      message: err?.message || "Could not update rider status. Try again.",
    });
  }
});

/** POST /admin/boda/riders/:id/delete — permanent wipe; requires confirm: true */
adminBodaRouter.post("/riders/:id/delete", async (req, res) => {
  if (!req.body?.confirm) {
    return res.status(400).json({
      error: "confirm_required",
      message: "Send { confirm: true } to permanently delete this rider.",
    });
  }
  try {
    const { isDbEnabled, query } = await import("../db/pool.js");
    if (!isDbEnabled()) {
      return res.status(503).json({ error: "database_not_configured" });
    }
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid_id" });
    const { rows } = await query(`SELECT id, phone, full_name FROM riders WHERE id = $1 LIMIT 1`, [id]);
    if (!rows[0]?.phone) {
      return res.status(404).json({ error: "not_found", message: "Rider not found." });
    }
    const { purgeRiderAccount } = await import("../services/purge-account.js");
    const out = await purgeRiderAccount(rows[0].phone, {
      confirm: true,
      adminLabel: "Admin panel",
    });
    if (!out.ok) return res.status(out.error === "not_found" ? 404 : 400).json(out);
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /admin/boda/riders/:id/bonus — fuel advance / bonus into CLEARED ledger */
adminBodaRouter.post("/riders/:id/bonus", async (req, res) => {
  const { adminRiderBonusPayout } = await import("../services/boda-fleet.js");
  const result = await adminRiderBonusPayout({
    riderId: req.params.id,
    amountKes: req.body?.amountKes ?? req.body?.amount,
    reason: req.body?.reason || "admin_bonus",
    orderRef: req.body?.orderRef || null,
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error === "database_not_configured") return res.status(503).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /admin/boda/riders/:id/override-noshow — bypass 15-min wait, start return */
adminBodaRouter.post("/riders/:id/override-noshow", async (req, res) => {
  const { adminOverrideNoShowTimer } = await import("../services/boda-fleet.js");
  const result = await adminOverrideNoShowTimer({
    orderId: req.body?.orderId || req.body?.orderRef,
    riderId: req.params.id,
    reason: req.body?.reason || "",
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /admin/boda/dispatches/force-reassign — REASSIGN RIDER via master path meta */
adminBodaRouter.post("/dispatches/force-reassign", async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || req.body?.orderRef || "").trim();
    const toPhone = String(req.body?.toRiderPhone || req.body?.phone || "").trim();
    if (!orderId || !toPhone) {
      return res.status(400).json({
        error: "missing_fields",
        message: "orderId and toRiderPhone required.",
      });
    }
    const { executeMasterAdminCommand } = await import("../services/admin-override.js");
    const result = await executeMasterAdminCommand(`REASSIGN RIDER ${orderId} ${toPhone}`, {
      adminLabel: String(req.body?.adminLabel || "fleet-directory").slice(0, 80),
      source: "admin-boda.force-reassign",
    });
    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      action: result.action,
      reply: result.reply,
      data: result.data || null,
    });
  } catch (err) {
    res.status(500).json({ error: "force_reassign_failed", message: err.message });
  }
});

/** POST /admin/boda/dispatches/auto-pin — ops force Sokoni pin for an order */
adminBodaRouter.post("/dispatches/auto-pin", async (req, res) => {
  const { createPlatformBodaDispatch } = await import("../services/boda-fleet.js");
  const result = await createPlatformBodaDispatch({
    orderId: req.body?.orderId,
    zone: req.body?.zone,
    pickupAddress: req.body?.pickupAddress || "",
    deliveryAddress: req.body?.deliveryAddress || "",
    deliveryFeeKes: req.body?.deliveryFeeKes,
    source: "admin_force",
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

adminBodaRouter.post("/dispatches/:id/release-fee", async (req, res) => {
  const { releaseBodaRiderFee } = await import("../services/boda-fleet.js");
  const result = await releaseBodaRiderFee({
    dispatchId: req.params.id,
    reason: req.body?.reason || "admin_manual",
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** GET /admin/boda/otp-audit?orderId=&riderId=&limit= */
adminBodaRouter.get("/otp-audit", async (req, res) => {
  const { listDeliveryOtpAudit } = await import("../services/boda-fleet.js");
  const result = await listDeliveryOtpAudit({
    orderId: req.query.orderId,
    riderId: req.query.riderId,
    limit: req.query.limit,
  });
  if (result.error === "database_not_configured") return res.status(503).json(result);
  res.json(result);
});

/** GET /admin/boda/disputes — frozen / disputed deliveries for review */
adminBodaRouter.get("/disputes", async (req, res) => {
  const { listRiderDisputes } = await import("../services/boda-fleet.js");
  const result = await listRiderDisputes({ limit: req.query.limit });
  if (result.error === "database_not_configured") return res.status(503).json(result);
  res.json(result);
});

/** POST /admin/boda/disputes/resolve — REACTIVATE_RIDER | PERMANENT_BAN */
adminBodaRouter.post("/disputes/resolve", async (req, res) => {
  const { resolveRiderDispute } = await import("../services/boda-fleet.js");
  const result = await resolveRiderDispute({
    disputeId: req.body?.disputeId || req.body?.dispatchId,
    dispatchId: req.body?.dispatchId,
    riderId: req.body?.riderId,
    action: req.body?.action,
    reason: req.body?.reason || "",
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /admin/boda/payouts/run-b2c — manually trigger rider B2C cycle */
adminBodaRouter.post("/payouts/run-b2c", async (req, res) => {
  const { processRiderB2CPayouts, RIDER_B2C_MIN_FLOOR_KES } = await import("../services/rider-b2c.js");
  const result = await processRiderB2CPayouts({
    minKes: req.body?.minKes ?? RIDER_B2C_MIN_FLOOR_KES,
    dailyCapKes: req.body?.dailyCapKes,
    limit: req.body?.limit,
  });
  if (result.reason === "b2c_not_configured") return res.status(503).json(result);
  res.json(result);
});

/** POST /admin/boda/payouts/approve — clear NEEDS_APPROVAL (fee > KES 1500) */
adminBodaRouter.post("/payouts/approve", async (req, res) => {
  const { approveRiderPayout } = await import("../services/boda-fleet.js");
  const result = await approveRiderPayout({
    payoutId: req.body?.payoutId,
    orderId: req.body?.orderId,
    approvedBy: req.body?.approvedBy || "admin-api",
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** GET /admin/boda/payouts/held — NEEDS_APPROVAL + PENDING_RETRY queue */
adminBodaRouter.get("/payouts/held", async (req, res) => {
  const { isDbEnabled, query } = await import("../db/pool.js");
  if (!isDbEnabled()) return res.status(503).json({ error: "database_not_configured" });
  const { rows } = await query(
    `SELECT p.*, r.full_name, r.phone, r.mpesa_account_name, r.mpesa_name_match_status
       FROM rider_payouts p
       LEFT JOIN riders r ON r.id = p.rider_id
      WHERE p.status IN ('NEEDS_APPROVAL', 'PENDING_RETRY')
         OR p.requires_manual_approval = TRUE
      ORDER BY p.id DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)]
  );
  res.json({ ok: true, payouts: rows });
});

adminBodaRouter.get("/summary", (_req, res) => {
  res.json({ ok: true, ...bodaSupportSummary() });
});
