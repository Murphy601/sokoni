import { Router } from "express";
import {
  onboardSellerAsync,
  getSellerProfile,
  getSellerEscrowLedgerByPhone,
  refreshSellerListing,
} from "../services/seller-onboard.js";
import { sendSellerVerificationCode, verifySellerCode } from "../services/seller-verification.js";

const router = Router();

/** POST /api/seller/onboard/send-code — WhatsApp OTP (free via WAHA) */
router.post("/send-code", async (req, res) => {
  const { phone } = req.body || {};
  const result = await sendSellerVerificationCode(phone);
  if (result.error === "rate_limited") return res.status(429).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/verify-code — confirm OTP, get signup token */
router.post("/verify-code", async (req, res) => {
  const { phone, code } = req.body || {};
  const result = await verifySellerCode(phone, code);
  if (result.error === "wrong_code" || result.error === "invalid_code") {
    return res.status(400).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/seller/onboard — WhatsApp phone + shop + M-Pesa setup */
router.post("/", async (req, res) => {
  const { phone, shopName, shopHandle, mpesaNumber, nationalId, verificationToken } = req.body || {};
  const result = await onboardSellerAsync({
    phone,
    shopName,
    shopHandle,
    mpesaNumber,
    nationalId,
    verificationToken,
  });
  if (result.error === "not_verified" || result.error === "verification_expired") {
    return res.status(403).json(result);
  }
  if (result.error === "invalid_mpesa" || result.error === "invalid_phone" || result.error === "missing_shop") {
    return res.status(400).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.status(result.existing ? 200 : 201).json(result);
});

/** GET /api/seller/onboard?phone= — seller profile */
router.get("/", (req, res) => {
  const result = getSellerProfile(req.query.phone);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

/** GET /api/seller/onboard/ledger?phone= — escrow ledger tabs */
router.get("/ledger", (req, res) => {
  const result = getSellerEscrowLedgerByPhone(req.query.phone);
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/refresh — bump listing timestamp */
router.post("/refresh", async (req, res) => {
  const { phone, productId } = req.body || {};
  const result = await refreshSellerListing({ phone, productId });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

export default router;
