#!/usr/bin/env node
/**
 * Regression: seller vs buyer session routing helpers + social error status map.
 * Mirrors the private helpers in socialApi.js so buyer OTP sessions are not
 * misclassified as seller sessions.
 */
let failed = 0;

function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

/** Keep in sync with socialApi.hasSellerSessionContext */
function hasSellerSessionContext(req, payload = req.body || {}) {
  const phone = payload?.phone || req.query?.phone;
  const sessionToken =
    payload?.sessionToken ||
    payload?.verificationToken ||
    req.query?.sessionToken ||
    req.query?.verificationToken ||
    req.headers["x-seller-session"];
  return Boolean(phone && sessionToken);
}

/** Keep in sync with buyer-social-auth.hasBuyerSessionContext */
function hasBuyerSessionContext(req, payload = req.body || {}) {
  return Boolean(
    (payload?.phone || req.query?.phone) &&
      (payload?.sessionToken ||
        payload?.verificationToken ||
        req.query?.sessionToken ||
        req.query?.verificationToken ||
        req.headers["x-buyer-session"])
  );
}

/** Keep in sync with socialApi.socialErrorStatus */
function socialErrorStatus(error) {
  if (error === "database_not_configured") return 503;
  if (
    error === "session_required" ||
    error === "session_invalid" ||
    error === "session_expired"
  ) {
    return 401;
  }
  if (error === "reminder_cooldown_active") return 429;
  if (
    error === "offer_not_found" ||
    error === "product_not_found" ||
    error === "user_not_found" ||
    error === "order_not_found" ||
    error === "receiver_not_found"
  ) {
    return 404;
  }
  return 400;
}

const buyerReq = {
  body: { phone: "254712345678", sessionToken: "buyer-token", senderUserId: 3 },
  query: {},
  headers: {},
};
assert(
  "buyer phone+token is seller context (shared fields)",
  hasSellerSessionContext(buyerReq, buyerReq.body) === true
);
assert(
  "buyer phone+token is also buyer context",
  hasBuyerSessionContext(buyerReq, buyerReq.body) === true
);

const phoneOnly = { body: { phone: "254712345678" }, query: {}, headers: {} };
assert(
  "phone-only is NOT seller context",
  hasSellerSessionContext(phoneOnly, phoneOnly.body) === false
);
assert(
  "phone-only is NOT buyer context",
  hasBuyerSessionContext(phoneOnly, phoneOnly.body) === false
);

const tokenOnly = { body: { sessionToken: "x" }, query: {}, headers: {} };
assert(
  "token-only is NOT seller context",
  hasSellerSessionContext(tokenOnly, tokenOnly.body) === false
);

const sellerHeader = {
  body: { phone: "254712345678" },
  query: {},
  headers: { "x-seller-session": "seller-token" },
};
assert(
  "seller header + phone counts as seller context",
  hasSellerSessionContext(sellerHeader, sellerHeader.body) === true
);

const buyerHeader = {
  body: { phone: "254712345678" },
  query: {},
  headers: { "x-buyer-session": "buyer-token" },
};
assert(
  "buyer header alone is not seller context",
  hasSellerSessionContext(buyerHeader, buyerHeader.body) === false
);
assert(
  "buyer header + phone is buyer context",
  hasBuyerSessionContext(buyerHeader, buyerHeader.body) === true
);

assert("session_required → 401", socialErrorStatus("session_required") === 401);
assert("session_invalid → 401", socialErrorStatus("session_invalid") === 401);
assert("reminder_cooldown_active → 429", socialErrorStatus("reminder_cooldown_active") === 429);
assert("offer_not_found → 404", socialErrorStatus("offer_not_found") === 404);
assert("database_not_configured → 503", socialErrorStatus("database_not_configured") === 503);

/**
 * Route precedence contract for chat/send + chat/thread:
 * 1) If phone+token present, try seller auth first.
 * 2) On ambiguous session errors (invalid/expired/required/bad phone), fall through
 *    to buyer auth — buyer OTP uses the same field names.
 * 3) On seller profile errors (not_onboarded, handle missing, etc.), fail closed.
 */
function isAmbiguousSessionAuthError(error) {
  return (
    error === "session_required" ||
    error === "session_invalid" ||
    error === "session_expired" ||
    error === "invalid_phone"
  );
}

assert("session_invalid is ambiguous (buyer fallthrough)", isAmbiguousSessionAuthError("session_invalid"));
assert("not_onboarded is NOT ambiguous", isAmbiguousSessionAuthError("not_onboarded") === false);
assert(
  "dual-auth field shape: phone+sessionToken detected by both helpers",
  hasSellerSessionContext(buyerReq, buyerReq.body) &&
    hasBuyerSessionContext(buyerReq, buyerReq.body)
);

console.log(`\n${failed ? failed + " failed" : "All social auth routing tests passed"}`);
process.exit(failed ? 1 : 0);
