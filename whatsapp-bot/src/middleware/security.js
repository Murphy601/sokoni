import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";

const SITE_ORIGINS = new Set([
  config.publicSiteUrl,
  "https://sokonimall.com",
  "https://www.sokonimall.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

/** Browser CORS — only sokonimall.com (and local static) may call the API from JS. */
export function corsAllowlist(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    const normalized = origin.replace(/\/$/, "");
    if (SITE_ORIGINS.has(normalized)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Seller-Session, X-Seller-Phone, X-Buyer-Session, X-Account-Token, X-Admin-Token, X-Sokoni-Token"
      );
      res.setHeader("Vary", "Origin");
    } else if (req.method === "OPTIONS") {
      return res.status(403).json({ error: "cors_blocked" });
    }
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

/** Capture raw body for WAHA HMAC and Paystack transfer webhooks. */
export function attachRawBody(req, _res, buf) {
  if (!buf?.length) return;
  const path = req.originalUrl?.split("?")[0] || req.url?.split("?")[0] || "";
  if (
    path === "/webhook" ||
    path === "/api/webhooks/paystack" ||
    path === "/api/payments/paystack" ||
    path === "/api/payments/paystack/webhook"
  ) {
    req.rawBody = Buffer.from(buf);
  }
}

function timingSafeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), "hex");
    const bb = Buffer.from(String(b), "hex");
    if (ba.length === 0 || ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Optional Meta Cloud API signature (X-Hub-Signature-256) when META_APP_SECRET is set.
 * Prevents spoofed webhook POSTs that could fake the Boss phone header.
 */
function verifyMetaHubSignature(req) {
  const secret = (
    process.env.META_APP_SECRET ||
    process.env.WHATSAPP_APP_SECRET ||
    process.env.FACEBOOK_APP_SECRET ||
    ""
  ).trim();
  const header = String(req.headers["x-hub-signature-256"] || "").trim();
  if (!secret || !header) return { attempted: false };
  const raw = req.rawBody;
  if (!raw?.length) return { attempted: true, ok: false, error: "webhook_auth_no_body" };
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { attempted: true, ok: false, error: "webhook_auth_invalid_meta" };
  }
  return { attempted: true, ok: true };
}

/**
 * Verify WAHA webhook HMAC when WEBHOOK_HMAC_KEY is set.
 * WAHA sends X-Webhook-Hmac (sha512 hex) over the raw body.
 * When Meta signature is present + META_APP_SECRET set, that path is accepted first.
 * When no secrets are configured, allow (local/dev) — log once.
 */
let warnedMissingHmac = false;

export function requireWahaWebhookAuth(req, res, next) {
  const meta = verifyMetaHubSignature(req);
  if (meta.attempted) {
    if (!meta.ok) {
      console.warn("[security] Meta X-Hub-Signature-256 rejected:", meta.error);
      return res.status(401).json({ error: meta.error || "webhook_auth_invalid" });
    }
    return next();
  }

  const key = (process.env.WEBHOOK_HMAC_KEY || process.env.WAHA_WEBHOOK_HMAC_KEY || "").trim();
  if (!key) {
    if (!warnedMissingHmac) {
      warnedMissingHmac = true;
      console.warn(
        "[security] WEBHOOK_HMAC_KEY / META_APP_SECRET unset — /webhook accepts any POST. Set a shared secret."
      );
    }
    return next();
  }

  const header = String(req.headers["x-webhook-hmac"] || "").trim();
  const algo = String(req.headers["x-webhook-hmac-algorithm"] || "sha512").trim().toLowerCase();
  if (!header) {
    return res.status(401).json({ error: "webhook_auth_required" });
  }
  if (algo && algo !== "sha512") {
    return res.status(401).json({ error: "webhook_auth_algorithm" });
  }

  const raw = req.rawBody;
  if (!raw?.length) {
    return res.status(401).json({ error: "webhook_auth_no_body" });
  }

  const expected = crypto.createHmac("sha512", key).update(raw).digest("hex");
  if (!timingSafeEqualHex(expected, header)) {
    console.warn("[security] WAHA webhook HMAC mismatch — rejected");
    return res.status(401).json({ error: "webhook_auth_invalid" });
  }
  next();
}

/** Alias — Meta hub signature OR WAHA HMAC. */
export const requireWebhookSignature = requireWahaWebhookAuth;

const jsonError = { error: "Too many requests, please try again later." };

/** Browser / public API — 60 req / min / IP */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonError,
});

/** Auth / OTP / agent — tighter (20 / min) */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AUTH_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonError,
});

/** Admin REST — 30 / min */
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_ADMIN_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonError,
});

/** WAHA webhooks — higher ceiling so message bursts are not dropped */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_WEBHOOK_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonError,
});
