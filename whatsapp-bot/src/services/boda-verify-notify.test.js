import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { riderVerificationNotifyText } from "./boda-fleet.js";

describe("riderVerificationNotifyText", () => {
  const rider = {
    fullName: "Peter Mwangi",
    motorbikePlate: "KMGB 123X",
    stageLocation: "westland",
    operatingTown: "NAIROBI",
    phone: "254748879579",
  };

  it("congratulates verified riders with plate + stage", () => {
    const text = riderVerificationNotifyText(rider, "VERIFIED");
    assert.match(text, /Congratulations Peter Mwangi/);
    assert.match(text, /KMGB 123X/);
    assert.match(text, /westland/);
    assert.match(text, /AVAILABLE|ONLINE/);
  });

  it("includes reject reason", () => {
    const text = riderVerificationNotifyText(rider, "REJECTED", "blurry ID");
    assert.match(text, /not approved/i);
    assert.match(text, /blurry ID/);
  });

  it("includes suspend reason", () => {
    const text = riderVerificationNotifyText(rider, "SUSPENDED", "no-show");
    assert.match(text, /SUSPENDED/);
    assert.match(text, /no-show/);
  });

  it("returns empty for unknown status", () => {
    assert.equal(riderVerificationNotifyText(rider, "PENDING"), "");
  });
});
