import { Router } from "express";
import {
  extractAccountToken,
  loginAccount,
  resolveAccountFromRequest,
  revokeAccountSession,
  signupAccount,
  updateSignedInProfile,
} from "../services/account-auth.js";

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

export default router;
