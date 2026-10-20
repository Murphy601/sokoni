import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { assertProductionWebhookHmac, requireDarajaCallbackAuth } from "./security.js";

describe("production webhook HMAC", () => {
  it("starts in development with no key", () => {
    assert.doesNotThrow(() => assertProductionWebhookHmac({ NODE_ENV: "development" }));
    assert.doesNotThrow(() => assertProductionWebhookHmac({}));
  });

  it("refuses to start in production when the key is missing", () => {
    assert.throws(
      () => assertProductionWebhookHmac({ NODE_ENV: "production" }),
      /WEBHOOK_HMAC_KEY is required/
    );
    assert.throws(
      () => assertProductionWebhookHmac({ NODE_ENV: "production", WEBHOOK_HMAC_KEY: "   " }),
      /WEBHOOK_HMAC_KEY is required/
    );
  });

  it("starts in production when either key name is set", () => {
    assert.doesNotThrow(() =>
      assertProductionWebhookHmac({ NODE_ENV: "production", WEBHOOK_HMAC_KEY: "abc" })
    );
    assert.doesNotThrow(() =>
      assertProductionWebhookHmac({ NODE_ENV: "production", WAHA_WEBHOOK_HMAC_KEY: "abc" })
    );
  });
});

describe("Daraja callback secret", () => {
  const prev = {
    DARAJA_CALLBACK_SECRET: process.env.DARAJA_CALLBACK_SECRET,
    MPESA_CALLBACK_SECRET: process.env.MPESA_CALLBACK_SECRET,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function run(req) {
    let status = 200;
    let body = null;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };
    let nextCalled = false;
    requireDarajaCallbackAuth(req, res, () => {
      nextCalled = true;
    });
    return { status, body, nextCalled, signed: req.darajaCallbackVerified };
  }

  it("passes through when no secret is configured", () => {
    delete process.env.DARAJA_CALLBACK_SECRET;
    delete process.env.MPESA_CALLBACK_SECRET;
    const out = run({ headers: {}, query: {} });
    assert.equal(out.nextCalled, true);
    assert.equal(out.signed, false);
  });

  it("rejects a missing or wrong secret", () => {
    process.env.DARAJA_CALLBACK_SECRET = "daraja-shared-test";
    const missing = run({ headers: {}, query: {} });
    assert.equal(missing.nextCalled, false);
    assert.equal(missing.status, 401);
    const wrong = run({ headers: { "x-webhook-secret": "nope" }, query: {} });
    assert.equal(wrong.status, 401);
  });

  it("accepts the header or query token", () => {
    process.env.DARAJA_CALLBACK_SECRET = "daraja-shared-test";
    const header = run({ headers: { "x-webhook-secret": "daraja-shared-test" }, query: {} });
    assert.equal(header.nextCalled, true);
    assert.equal(header.signed, true);
    const query = run({ headers: {}, query: { token: "daraja-shared-test" } });
    assert.equal(query.nextCalled, true);
    assert.equal(query.signed, true);
  });
});
