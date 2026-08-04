import { Router } from "express";
import {
  extractAccountToken,
  linkWhatsAppToAccount,
  loginAccount,
  loginWithWhatsApp,
  requestPasswordReset,
  resetPasswordWithToken,
  resolveAccountFromRequest,
  revokeAccountSession,
  signupAccount,
  updateSignedInProfile,
} from "../services/account-auth.js";
import { claimOrderForAccount, getPurchasesForAccount } from "../services/orders.js";

const router = Router();

/** POST /api/account/auth/signup */
router.post("/signup", async (req, res) => {
  const { email, password, displayName, phone } = req.body || {};
  const result = await signupAccount({ email, password, displayName, phone });
  if (result.error === "database_not_configured") return res.status(503).json(result);
  if (result.error === "email_taken") return res.status(409).json(result);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

/** POST /api/account/auth/login */
router.post("/login", async (req, res) => {
  const { email, password, rememberMe } = req.body || {};
  const result = await loginAccount({ email, password, rememberMe: Boolean(rememberMe) });
  if (result.error === "database_not_configured") return res.status(503).json(result);
  if (result.error === "invalid_credentials") return res.status(401).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** GET /api/account/auth/session */
router.get("/session", async (req, res) => {
  const auth = await resolveAccountFromRequest(req);
  if (auth.error) return res.status(auth.error === "session_required" ? 401 : 403).json(auth);
  res.json({
    ok: true,
    user: auth.user,
    expiresAt: auth.expiresAt,
  });
});

/** POST /api/account/auth/sign-out */
router.post("/sign-out", async (req, res) => {
  const token = extractAccountToken(req);
  const result = await revokeAccountSession(token);
  res.json(result);
});

/** POST /api/account/auth/forgot-password */
router.post("/forgot-password", async (req, res) => {
  const result = await requestPasswordReset(req.body?.email);
  if (result.error === "database_not_configured") return res.status(503).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/account/auth/reset-password */
router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  const result = await resetPasswordWithToken({ token, password });
  if (result.error === "database_not_configured") return res.status(503).json(result);
  if (result.error === "invalid_token") return res.status(400).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/account/auth/whatsapp-login — after buyer OTP verify */
router.post("/whatsapp-login", async (req, res) => {
  const { phone, buyerSessionToken, sessionToken } = req.body || {};
  const result = await loginWithWhatsApp({
    phone,
    buyerSessionToken: buyerSessionToken || sessionToken,
  });
  if (result.error === "database_not_configured") return res.status(503).json(result);
  if (result.error === "need_signup") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** PATCH /api/account/auth/profile — display name / phone */
router.patch("/profile", async (req, res) => {
  const token = extractAccountToken(req);
  const { displayName, phone } = req.body || {};
  const result = await updateSignedInProfile(token, { displayName, phone });
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** GET /api/account/auth/purchases — my orders for signed-in account */
router.get("/purchases", async (req, res) => {
  const auth = await resolveAccountFromRequest(req);
  if (auth.error) return res.status(auth.error === "session_required" ? 401 : 403).json(auth);
  const purchases = getPurchasesForAccount({
    userId: auth.user.id,
    phone: auth.user.phone,
  });
  res.json({
    ok: true,
    purchases,
    phoneOnFile: Boolean(auth.user.phone),
    hint: auth.user.phone
      ? null
      : "Add your WhatsApp number on this account to see prepaid orders placed by phone.",
  });
});

/** POST /api/account/auth/link-whatsapp — bind verified buyer/seller OTP to email account */
router.post("/link-whatsapp", async (req, res) => {
  const accountToken = extractAccountToken(req);
  const {
    phone,
    buyerSessionToken,
    sellerSessionToken,
    whatsappSessionToken,
    role,
  } = req.body || {};
  const result = await linkWhatsAppToAccount({
    accountToken,
    phone,
    whatsappSessionToken:
      whatsappSessionToken || buyerSessionToken || sellerSessionToken || "",
    role: role === "seller" || sellerSessionToken ? "seller" : "buyer",
  });
  if (
    result.error === "session_required" ||
    result.error === "session_invalid" ||
    result.error === "session_expired"
  ) {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/account/auth/claim-order — link SK-#### when phone matches */
router.post("/claim-order", async (req, res) => {
  const auth = await resolveAccountFromRequest(req);
  if (auth.error) return res.status(auth.error === "session_required" ? 401 : 403).json(auth);
  const orderId = String(req.body?.orderId || "").trim().toUpperCase();
  if (!orderId) return res.status(400).json({ error: "missing_order_id", message: "Send orderId like SK-1022." });
  if (!auth.user.phone) {
    return res.status(400).json({
      error: "phone_required",
      message: "Add your WhatsApp number to your account first (same number used at checkout).",
    });
  }
  const result = claimOrderForAccount(orderId, {
    userId: auth.user.id,
    phone: auth.user.phone,
    email: auth.user.email,
  });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

export default router;
