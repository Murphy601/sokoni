import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveOrderFromStkCallback } from "./escrow-automation.js";

describe("STK callback order binding", () => {
  it("ignores unsigned phone+amount guesses", () => {
    const parsed = {
      valid: true,
      success: true,
      phoneNumber: "254700000099",
      amount: 1500,
    };
    assert.equal(resolveOrderFromStkCallback(parsed), null);
    assert.equal(resolveOrderFromStkCallback(parsed, { signed: false }), null);
  });

  it("ignores an unknown CheckoutRequestID", () => {
    const parsed = {
      valid: true,
      success: true,
      checkoutRequestId: "ws_unknown_checkout_id",
      amount: 1500,
    };
    assert.equal(resolveOrderFromStkCallback(parsed), null);
  });
});
