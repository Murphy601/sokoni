import { Router } from "express";
import {
  onboardSellerAsync,
  getSellerProfile,
  getSellerEscrowLedgerByPhone,
  getSellerOrdersByPhone,
  refreshSellerListing,
  updateSellerListingPrice,
} from "../services/seller-onboard.js";
import {
  getSellerWithdrawSummaryByPhone,
  requestSellerWithdrawal,
} from "../services/seller-withdrawals.js";
import {
  sendSellerVerificationCode,
  verifySellerCode,
  revokeSellerSession,
  sellerSessionFromReq,
} from "../services/seller-verification.js";

const router = Router();

/** POST /api/seller/onboard/send-code — WhatsApp OTP (free via WAHA) */
router.post("/send-code", async (req, res) => {
  const { phone } = req.body || {};
  const result = await sendSellerVerificationCode(phone);
  if (result.error === "rate_limited") return res.status(429).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/verify-code — confirm OTP, get session token */
router.post("/verify-code", async (req, res) => {
  const { phone, code } = req.body || {};
  const result = await verifySellerCode(phone, code);
  if (result.error === "wrong_code" || result.error === "invalid_code") {
    return res.status(400).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/sign-out — revoke server session */
router.post("/sign-out", async (req, res) => {
  const { phone } = req.body || {};
  const result = await revokeSellerSession(phone);
  res.json(result);
});

/** POST /api/seller/onboard — WhatsApp phone + shop + M-Pesa setup */
router.post("/", async (req, res) => {
  const { phone, shopName, shopHandle, mpesaNumber, nationalId, sessionToken, verificationToken } =
    req.body || {};
  const result = await onboardSellerAsync({
    phone,
    shopName,
    shopHandle,
    mpesaNumber,
    nationalId,
    sessionToken: sessionToken || verificationToken || sellerSessionFromReq(req),
  });
  if (result.error === "not_verified" || result.error === "verification_expired") {
    return res.status(403).json(result);
  }
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error === "invalid_mpesa" || result.error === "invalid_phone" || result.error === "missing_shop") {
    return res.status(400).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.status(result.existing ? 200 : 201).json(result);
});

/** GET /api/seller/onboard?phone= — seller profile (requires session) */
router.get("/", async (req, res) => {
  const result = await getSellerProfile(req.query.phone, sellerSessionFromReq(req));
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.needsSetup) return res.status(404).json(result);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

/** GET /api/seller/onboard/ledger?phone= — escrow ledger tabs */
router.get("/ledger", async (req, res) => {
  const result = await getSellerEscrowLedgerByPhone(req.query.phone, sellerSessionFromReq(req));
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** GET /api/seller/onboard/orders?phone= — paid orders, labels, shipment status */
router.get("/orders", async (req, res) => {
  const result = await getSellerOrdersByPhone(req.query.phone, sellerSessionFromReq(req));
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** GET /api/seller/onboard/withdraw?phone= — available balance + withdrawal history */
router.get("/withdraw", async (req, res) => {
  const result = await getSellerWithdrawSummaryByPhone(req.query.phone, sellerSessionFromReq(req));
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/withdraw — request manual M-Pesa payout */
router.post("/withdraw", async (req, res) => {
  const { phone } = req.body || {};
  const result = await requestSellerWithdrawal(phone, sellerSessionFromReq(req));
  if (result.error === "no_balance") return res.status(400).json(result);
  if (result.error === "withdrawal_pending") return res.status(409).json(result);
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/refresh — bump listing timestamp */
router.post("/refresh", async (req, res) => {
  const { phone, productId } = req.body || {};
  const result = await refreshSellerListing({
    phone,
    productId,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/price — update live listing seller-net (notifies likers on drop) */
router.post("/price", async (req, res) => {
  const { phone, productId, sellerNetKes, priceKes } = req.body || {};
  const result = await updateSellerListingPrice({
    phone,
    productId,
    sellerNetKes: sellerNetKes ?? priceKes,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error === "invalid_price") return res.status(400).json(result);
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

export default router;
