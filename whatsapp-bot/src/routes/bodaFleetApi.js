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
  const result = await listRiders({
    zone: req.query.zone,
    status: req.query.status,
    limit: req.query.limit,
  });
  if (result.error === "database_not_configured") return res.status(503).json(result);
  res.json(result);
});

adminBodaRouter.post("/riders", async (req, res) => {
  const result = await upsertRiderProfile(req.body || {});
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

adminBodaRouter.post("/riders/:id/verify", async (req, res) => {
  const result = await setRiderVerificationStatus(req.params.id, req.body?.status || "VERIFIED", {
    reason: req.body?.reason || "",
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

adminBodaRouter.get("/summary", (_req, res) => {
  res.json({ ok: true, ...bodaSupportSummary() });
});
