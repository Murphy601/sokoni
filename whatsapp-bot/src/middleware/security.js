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
        "Content-Type, X-Seller-Session, X-Buyer-Session, X-Admin-Token, X-Sokoni-Token"
      );
      res.setHeader("Vary", "Origin");
    } else if (req.method === "OPTIONS") {
      return res.status(403).json({ error: "cors_blocked" });
    }
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

/** Capture raw body for WAHA HMAC (sha512 of raw JSON) — use as express.json verify. */
export function attachRawBody(req, _res, buf) {
  if (!buf?.length) return;
  const path = req.originalUrl?.split("?")[0] || req.url?.split("?")[0] || "";
  if (path === "/webhook") {
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
 * Verify WAHA webhook HMAC when WEBHOOK_HMAC_KEY is set.
 * WAHA sends X-Webhook-Hmac (sha512 hex) over the raw body.
 * When the key is unset, allow (local/dev) — log once.
 */
let warnedMissingHmac = false;

export function requireWahaWebhookAuth(req, res, next) {
  const key = (process.env.WEBHOOK_HMAC_KEY || process.env.WAHA_WEBHOOK_HMAC_KEY || "").trim();
  if (!key) {
    if (!warnedMissingHmac) {
      warnedMissingHmac = true;
      console.warn(
        "[security] WEBHOOK_HMAC_KEY unset — /webhook accepts any POST. Set a shared secret and reconfigure WAHA."
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
