#!/usr/bin/env node
/**
 * Regression tests: buyer social auth soft/hard/off gates.
 * No DB or WhatsApp required for these cases.
 */
import { config } from "../src/config.js";
import {
  applyBuyerIdentityAuth,
  getBuyerAuthMode,
  hasBuyerSessionContext,
} from "../src/services/buyer-social-auth.js";
import { validateBuyerSession } from "../src/services/buyer-verification.js";

let failed = 0;
const originalMode = config.buyerAuth?.mode;

function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

function setMode(mode) {
  config.buyerAuth = { ...(config.buyerAuth || {}), mode };
}

function fakeReq({ body = {}, query = {}, headers = {} } = {}) {
  return { body, query, headers };
}

async function run() {
  setMode("soft");
  assert("default mode soft", getBuyerAuthMode() === "soft");

  setMode("HARD");
  assert("mode hard normalizes", getBuyerAuthMode() === "hard");

  setMode("off");
  assert("mode off", getBuyerAuthMode() === "off");

  setMode("weird");
  assert("unknown mode falls back to soft", getBuyerAuthMode() === "soft");

  assert(
    "session context from body phone+token",
    hasBuyerSessionContext(fakeReq({ body: { phone: "254712345678", sessionToken: "abc" } })) === true
  );
  assert(
    "session context from query",
    hasBuyerSessionContext(
      fakeReq({ query: { phone: "254712345678", sessionToken: "abc" } }),
      {}
    ) === true
  );
  assert(
    "session context from X-Buyer-Session header",
    hasBuyerSessionContext(
      fakeReq({
        body: { phone: "254712345678" },
        headers: { "x-buyer-session": "abc" },
      })
    ) === true
  );
  assert(
    "no session without phone",
    hasBuyerSessionContext(fakeReq({ body: { sessionToken: "abc" } })) === false
  );
  assert(
    "no session without token",
    hasBuyerSessionContext(fakeReq({ body: { phone: "254712345678" } })) === false
  );

  setMode("off");
  {
    const gated = await applyBuyerIdentityAuth(
      fakeReq({ body: { buyerUserId: 9 } }),
      { buyerUserId: 9 },
      "buyerUserId"
    );
    assert("off mode allows unauthed", gated.ok === true && gated.softUnauthed === true);
    assert("off mode keeps client id", gated.payload.buyerUserId === 9);
  }

  setMode("soft");
  {
    const gated = await applyBuyerIdentityAuth(
      fakeReq({ body: { followerUserId: 3, followingUserId: 8 } }),
      { followerUserId: 3, followingUserId: 8 },
      "followerUserId"
    );
    assert("soft mode allows legacy client id", gated.ok === true && gated.softUnauthed === true);
    assert("soft mode preserves followerUserId", gated.payload.followerUserId === 3);
  }

  setMode("hard");
  {
    const gated = await applyBuyerIdentityAuth(
      fakeReq({ body: { userId: 4, productId: "p1" } }),
      { userId: 4, productId: "p1" },
      "userId"
    );
    assert("hard mode requires session", gated.error === "session_required");
    assert("hard mode returns 401", gated.status === 401);
  }

  setMode("soft");
  {
    const req = fakeReq({
      body: {
        buyerUserId: 11,
        phone: "254700000001",
        sessionToken: "not-a-real-token",
      },
    });
    const gated = await applyBuyerIdentityAuth(req, req.body, "buyerUserId");
    assert(
      "soft mode rejects invalid session when provided",
      gated.error === "session_invalid" || gated.error === "invalid_phone"
    );
    assert("invalid session status is 401/400", gated.status === 401 || gated.status === 400);
  }

  setMode("hard");
  {
    const req = fakeReq({
      body: {
        senderUserId: 22,
        phone: "254712345678",
        sessionToken: "expired-or-wrong",
      },
    });
    const gated = await applyBuyerIdentityAuth(req, req.body, "senderUserId");
    assert("hard mode rejects bad session", gated.error === "session_invalid");
    assert("hard bad session is 401", gated.status === 401);
  }

  {
    const invalid = await validateBuyerSession("254712345678", "");
    assert("validateBuyerSession empty token → session_required", invalid.error === "session_required");
    const bad = await validateBuyerSession("254712345678", "nope");
    assert("validateBuyerSession wrong token → session_invalid", bad.error === "session_invalid");
    const badPhone = await validateBuyerSession("123", "token");
    assert("validateBuyerSession bad phone → invalid_phone", badPhone.error === "invalid_phone");
  }

  // Identity field contract names used by routes
  const identityFields = ["followerUserId", "buyerUserId", "senderUserId", "userId"];
  setMode("soft");
  for (const field of identityFields) {
    const payload = { [field]: 77 };
    const gated = await applyBuyerIdentityAuth(fakeReq({ body: payload }), payload, field);
    assert(`soft unauthed preserves ${field}`, gated.ok && gated.payload[field] === 77);
  }
}

run()
  .catch((err) => {
    console.error("FAIL: unexpected error", err);
    failed += 1;
  })
  .finally(() => {
    if (originalMode != null) setMode(originalMode);
    console.log(`\n${failed ? failed + " failed" : "All buyer social auth tests passed"}`);
    process.exit(failed ? 1 : 0);
  });
