import { findOrCreateBuyerUserByPhone } from "../db/repositories/users.js";
import { config } from "../config.js";
import {
  buyerSessionFromReq,
  normalizeBuyerPhone,
  validateBuyerSession,
} from "./buyer-verification.js";

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function buyerLookupStatus(error) {
  if (error === "database_not_configured") return 503;
  if (error === "invalid_phone") return 400;
  if (error === "session_required" || error === "session_invalid" || error === "session_expired") return 401;
  return 403;
}

export function getBuyerAuthMode() {
  const mode = String(config.buyerAuth?.mode || process.env.BUYER_AUTH_MODE || "soft")
    .trim()
    .toLowerCase();
  if (mode === "hard" || mode === "off" || mode === "soft") return mode;
  return "soft";
}

export function hasBuyerSessionContext(req, payload = req.body || {}) {
  return Boolean(
    (payload?.phone || req.query?.phone) &&
      (payload?.sessionToken ||
        payload?.verificationToken ||
        req.query?.sessionToken ||
        req.query?.verificationToken ||
        req.headers["x-buyer-session"])
  );
}

export async function resolveAuthenticatedBuyerSocialContext(req) {
  const phone = req.body?.phone || req.query?.phone;
  const sessionToken = buyerSessionFromReq(req);
  const session = await validateBuyerSession(phone, sessionToken);
  if (session.error) {
    return {
      error: session.error,
      message: session.message,
      status: buyerLookupStatus(session.error),
    };
  }

  const userResult = await findOrCreateBuyerUserByPhone(session.phone);
  if (userResult.error) {
    return {
      error: userResult.error,
      message: userResult.message || "Could not resolve buyer profile for this session.",
      status: buyerLookupStatus(userResult.error),
    };
  }

  const buyerUserId = parsePositiveInt(userResult.user?.id);
  if (!buyerUserId) {
    return {
      error: "buyer_user_not_linked",
      message: "Could not link this WhatsApp number to a buyer profile.",
      status: 403,
    };
  }

  return {
    ok: true,
    phone: normalizeBuyerPhone(session.phone),
    buyerUserId,
    user: userResult.user,
  };
}

/**
 * Soft/hard buyer auth gate for social mutations.
 * - soft: if session present, validate + overwrite identity field; else keep legacy behavior
 * - hard: require valid buyer session
 * - off: skip auth checks
 */
export async function applyBuyerIdentityAuth(req, payload, identityField) {
  const mode = getBuyerAuthMode();
  if (mode === "off") {
    return { ok: true, mode, payload, softUnauthed: true };
  }

  const hasContext = hasBuyerSessionContext(req, payload);
  if (!hasContext) {
    if (mode === "hard") {
      return {
        error: "session_required",
        message: "Sign in with WhatsApp before this action.",
        status: 401,
        mode,
      };
    }
    return { ok: true, mode, payload, softUnauthed: true };
  }

  const auth = await resolveAuthenticatedBuyerSocialContext(req);
  if (auth.error) {
    return { ...auth, mode };
  }

  const requested = parsePositiveInt(payload?.[identityField]);
  if (requested && requested !== auth.buyerUserId) {
    return {
      error: "buyer_session_mismatch",
      message: "Buyer session does not match the user profile in this request.",
      status: 403,
      mode,
    };
  }

  const nextPayload = { ...(payload || {}) };
  nextPayload[identityField] = auth.buyerUserId;
  nextPayload.phone = auth.phone;
  return {
    ok: true,
    mode,
    payload: nextPayload,
    buyerUserId: auth.buyerUserId,
    phone: auth.phone,
  };
}
