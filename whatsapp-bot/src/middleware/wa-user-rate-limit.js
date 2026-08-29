/**
 * Per-WhatsApp-user token bucket — protects LLM spend & DB from spam.
 * Complements IP-level webhookLimiter in security.js.
 */

const DEFAULT_MAX = Number(process.env.WA_USER_RATE_MAX) || 10;
const DEFAULT_WINDOW_MS = Number(process.env.WA_USER_RATE_WINDOW_MS) || 60_000;

/** @type {Map<string, { count: number, resetAt: number, blockedUntil: number }>} */
const buckets = new Map();

const SPAM_REPLY =
  `⏳ You're sending messages too quickly. Please wait a minute and try again.\n` +
  `For order help, reply *track SKN-####* or *menu*.`;

function keyFor(customerKey, phone = "") {
  return String(customerKey || phone || "unknown").toLowerCase().slice(0, 80);
}

/**
 * @returns {{ allowed: boolean, retryAfterSec?: number, message?: string }}
 */
export function checkWhatsAppUserRateLimit(customerKey, phone = "", {
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS,
} = {}) {
  const key = keyFor(customerKey, phone);
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs, blockedUntil: 0 };
    buckets.set(key, b);
  }
  if (b.blockedUntil && now < b.blockedUntil) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((b.blockedUntil - now) / 1000),
      message: SPAM_REPLY,
    };
  }
  b.count += 1;
  if (b.count > max) {
    b.blockedUntil = now + windowMs;
    return {
      allowed: false,
      retryAfterSec: Math.ceil(windowMs / 1000),
      message: SPAM_REPLY,
    };
  }
  // Opportunistic prune
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now >= v.resetAt && now >= (v.blockedUntil || 0)) buckets.delete(k);
    }
  }
  return { allowed: true, remaining: Math.max(0, max - b.count) };
}

export function whatsappSpamAutoReply() {
  return SPAM_REPLY;
}

/** Test helper */
export function _resetWhatsAppRateBuckets() {
  buckets.clear();
}
