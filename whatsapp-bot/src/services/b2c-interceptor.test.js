import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOverrideCommand,
  normalizeMasterCommand,
} from "./admin-override.js";
import { isSellerBlockedForB2C, isRiderBlockedForB2C } from "./b2c-interceptor.js";

describe("B2C interceptor commands", () => {
  it("detects RELEASE PAYOUT and REFUND DISPUTE", () => {
    assert.equal(isOverrideCommand("RELEASE PAYOUT +254712345678"), true);
    assert.equal(isOverrideCommand("REFUND DISPUTE SKN-1204"), true);
    assert.equal(
      normalizeMasterCommand("RELEASE PAYOUT +254712345678"),
      "RELEASE_PAYOUT +254712345678"
    );
    assert.equal(normalizeMasterCommand("REFUND DISPUTE SKN-1204"), "REFUND SKN-1204");
  });

  it("blocks paused / suspended sellers for B2C", () => {
    assert.equal(isSellerBlockedForB2C({ shopStatus: "live", payoutHold: false }), false);
    assert.equal(isSellerBlockedForB2C({ shopStatus: "paused" }), true);
    assert.equal(isSellerBlockedForB2C({ shopStatus: "deactivated" }), true);
    assert.equal(isSellerBlockedForB2C({ shopStatus: "live", payoutHold: true }), true);
  });

  it("blocks suspended / admin-paused riders for B2C", () => {
    assert.equal(
      isRiderBlockedForB2C({ verification_status: "VERIFIED", suspend_reason: null }),
      false
    );
    assert.equal(isRiderBlockedForB2C({ verification_status: "SUSPENDED" }), true);
    assert.equal(
      isRiderBlockedForB2C({
        verification_status: "VERIFIED",
        suspend_reason: "ADMIN_PAUSE: ops",
      }),
      true
    );
  });
});
