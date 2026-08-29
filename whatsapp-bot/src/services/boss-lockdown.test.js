import test from "node:test";
import assert from "node:assert/strict";
import { checkIfBoss, BOSS_HARDWIRE_TAILS } from "../lib/phone-normalize.js";
import { isMasterCommand, normalizeMasterCommand } from "../services/admin-override.js";
import { requireWahaWebhookAuth } from "../middleware/security.js";
import crypto from "node:crypto";

test("Boss hardwire includes 757764009", () => {
  assert.ok(BOSS_HARDWIRE_TAILS.includes("757764009"));
  assert.equal(checkIfBoss("254757764009"), true);
  assert.equal(checkIfBoss("0757764009"), true);
  assert.equal(checkIfBoss("+254 757 764 009"), true);
  assert.equal(checkIfBoss("254700000000"), false);
});

test("FORCE RELEASE normalizes before LLM", () => {
  assert.equal(isMasterCommand("FORCE RELEASE SKN-8820"), true);
  assert.equal(normalizeMasterCommand("FORCE RELEASE SKN-8820"), "RELEASE SKN-8820");
  assert.equal(normalizeMasterCommand("FORCE_PAYOUT SKN-1002-1"), "RELEASE SKN-1002-1");
});

test("Meta X-Hub-Signature-256 accepted when META_APP_SECRET set", async () => {
  const secret = "test-meta-secret";
  process.env.META_APP_SECRET = secret;
  delete process.env.WEBHOOK_HMAC_KEY;
  delete process.env.WAHA_WEBHOOK_HMAC_KEY;

  const body = Buffer.from(JSON.stringify({ entry: [] }));
  const sig =
    "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

  const req = {
    headers: { "x-hub-signature-256": sig },
    rawBody: body,
  };
  let status = null;
  const res = {
    status(code) {
      status = code;
      return { json() {} };
    },
  };
  let nextCalled = false;
  requireWahaWebhookAuth(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(status, null);

  delete process.env.META_APP_SECRET;
});

test("Meta signature mismatch rejected", () => {
  process.env.META_APP_SECRET = "test-meta-secret";
  const body = Buffer.from("{}");
  const req = {
    headers: { "x-hub-signature-256": "sha256=deadbeef" },
    rawBody: body,
  };
  let status = null;
  const res = {
    status(code) {
      status = code;
      return {
        json() {
          return this;
        },
      };
    },
  };
  requireWahaWebhookAuth(req, res, () => {
    assert.fail("should not next");
  });
  assert.equal(status, 401);
  delete process.env.META_APP_SECRET;
});
