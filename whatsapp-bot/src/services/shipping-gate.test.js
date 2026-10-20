import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspectOrderShippingReadiness } from "../services/shipping-gate.js";

describe("shipping gate readiness", () => {
  it("pickup-only orders do not need shipping rates", () => {
    const r = inspectOrderShippingReadiness({
      id: "SKN-1",
      deliveryMode: "pickup_point",
      shopHandle: "nosuchshopzzzz",
    });
    assert.equal(r.needsShipping, false);
    assert.equal(r.configured, true);
  });

  it("delivery orders without profile are not configured", () => {
    const r = inspectOrderShippingReadiness({
      id: "SKN-2",
      shopHandle: "definitely-missing-vendor-key-xyz",
      sellerPhone: "254700000099",
    });
    assert.equal(r.needsShipping, true);
    assert.equal(r.configured, false);
  });
});
