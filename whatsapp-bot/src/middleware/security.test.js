import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProductionWebhookHmac } from "./security.js";

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
