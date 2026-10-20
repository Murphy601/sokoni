import { Router } from "express";
import { findOrCreateBuyerUserByPhone } from "../db/repositories/users.js";
import {
  revokeBuyerSession,
  sendBuyerVerificationCode,
  verifyBuyerCode,
} from "../services/buyer-verification.js";
import { getBuyerAuthMode, resolveAuthenticatedBuyerSocialContext } from "../services/buyer-social-auth.js";

const router = Router();

/** POST /api/buyer/auth/send-code */
router.post("/send-code", async (req, res) => {
  const { phone } = req.body || {};
  const result = await sendBuyerVerificationCode(phone);
  if (result.error === "rate_limited") return res.status(429).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/buyer/auth/verify-code */
router.post("/verify-code", async (req, res) => {
  const { phone, code } = req.body || {};
  const verified = await verifyBuyerCode(phone, code);
  if (
    verified.error === "wrong_code" ||
    verified.error === "invalid_code" ||
    verified.error === "no_code" ||
    verified.error === "expired" ||
    verified.error === "too_many_attempts"
  ) {
    return res.status(400).json(verified);
  }
  if (verified.error) return res.status(400).json(verified);

  const userResult = await findOrCreateBuyerUserByPhone(verified.phone);
  if (userResult.error) {
    return res.status(userResult.error === "database_not_configured" ? 503 : 400).json({
      error: userResult.error,
      message: userResult.message,
    });
  }

  res.json({
    success: true,
    sessionToken: verified.sessionToken,
    verificationToken: verified.verificationToken,
    phone: verified.phone,
    userId: userResult.user.id,
    user: userResult.user,
    expiresInSec: verified.expiresInSec,
    message: verified.message,
    authMode: getBuyerAuthMode(),
  });
});

/** GET /api/buyer/auth/session — validate current buyer session */
router.get("/session", async (req, res) => {
  const auth = await resolveAuthenticatedBuyerSocialContext(req);
  if (auth.error) {
    return res.status(auth.status || 403).json({
      error: auth.error,
      message: auth.message,
      authMode: getBuyerAuthMode(),
    });
  }
  res.json({
    ok: true,
    phone: auth.phone,
    userId: auth.buyerUserId,
    user: auth.user,
    authMode: getBuyerAuthMode(),
  });
});

/** POST /api/buyer/auth/sign-out */
router.post("/sign-out", async (req, res) => {
  const { phone } = req.body || {};
  const result = await revokeBuyerSession(phone);
  res.json(result);
});

export default router;
