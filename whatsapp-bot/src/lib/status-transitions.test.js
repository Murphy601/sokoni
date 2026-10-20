import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertOrderTransition,
  assertCustodyTransition,
  assertDispatchStatusTransition,
  canCancelOrder,
} from "./status-transitions.js";
import {
  checkWhatsAppUserRateLimit,
  _resetWhatsAppRateBuckets,
} from "../middleware/wa-user-rate-limit.js";

describe("status-transitions", () => {
  it("allows paid flow awaiting_payment → confirmed", () => {
    assert.equal(assertOrderTransition("awaiting_payment", "confirmed").ok, true);
  });

  it("blocks delivered → awaiting_payment", () => {
    const r = assertOrderTransition("delivered", "awaiting_payment");
    assert.equal(r.ok, false);
  });

  it("blocks cancel while custody IN_TRANSIT", () => {
    const r = canCancelOrder({
      orderStatus: "out_for_delivery",
      dispatchStatus: "OTP_SENT",
      custodyStatus: "IN_TRANSIT",
    });
    assert.equal(r.ok, false);
  });

  it("allows UNASSIGNED → ASSIGNED custody", () => {
    assert.equal(assertCustodyTransition("UNASSIGNED", "ASSIGNED").ok, true);
  });

  it("blocks REQUESTED → DELIVERED dispatch jump", () => {
    assert.equal(assertDispatchStatusTransition("REQUESTED", "DELIVERED").ok, false);
  });
});

describe("wa-user-rate-limit", () => {
  it("allows under cap then blocks", () => {
    _resetWhatsAppRateBuckets();
    const key = "test-rate@c.us";
    for (let i = 0; i < 10; i++) {
      assert.equal(checkWhatsAppUserRateLimit(key, "", { max: 10 }).allowed, true);
    }
    const blocked = checkWhatsAppUserRateLimit(key, "", { max: 10 });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.message || "", /too quickly/i);
  });
});
