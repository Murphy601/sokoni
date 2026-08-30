import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPickupMenuIntent, isRiderPickupOtpCommand } from "./role-menus.js";

describe("pickup menu vs rider OTP routing", () => {
  it("detects rider PICK UP / PICKUP SKN commands", () => {
    assert.equal(isRiderPickupOtpCommand("Pick up SkN-1015 5972"), true);
    assert.equal(isRiderPickupOtpCommand("PICKUP SKN-1015 5972"), true);
    assert.equal(isRiderPickupOtpCommand("pickup skn1015 5972"), true);
    assert.equal(isRiderPickupOtpCommand("PICK UP SKN-1015"), true);
    assert.equal(isRiderPickupOtpCommand("pickup menu"), false);
    assert.equal(isRiderPickupOtpCommand("pick up point"), false);
  });

  it("does not steal rider OTP for Become a pickup point menu", () => {
    assert.equal(isPickupMenuIntent("Pick up SkN-1015 5972"), false);
    assert.equal(isPickupMenuIntent("PICKUP SKN-1015 5972"), false);
    assert.equal(isPickupMenuIntent("pickup skn-1015 5972"), false);
  });

  it("still opens pickup-point apply for real menu intents", () => {
    assert.equal(isPickupMenuIntent("pickup"), true);
    assert.equal(isPickupMenuIntent("pickup menu"), true);
    assert.equal(isPickupMenuIntent("pick up point"), true);
    assert.equal(isPickupMenuIntent("become a pickup point"), true);
  });
});
