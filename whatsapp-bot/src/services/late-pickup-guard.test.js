import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, "boda-fleet.js"), "utf-8");
const WH = readFileSync(
  path.join(__dirname, "..", "handlers", "webhookHandler.js"),
  "utf-8"
);

describe("late pickup timeout safety", () => {
  it("expire SELECT excludes IN_TRANSIT / delivery OTP / pickupVerified", () => {
    assert.match(SRC, /custody_status, ''\) NOT IN \('IN_TRANSIT'/);
    assert.match(SRC, /delivery_otp_hash IS NULL/);
    assert.match(SRC, /meta->>'pickupVerified'/);
  });

  it("expire UPDATE is conditional on still ACCEPTED + no pickup", () => {
    assert.match(SRC, /AND status = 'ACCEPTED'/);
    assert.match(SRC, /AND picked_up_at IS NULL/);
    assert.match(SRC, /if \(!upd\.rows\[0\]\) return null/);
  });

  it("confirmPickupWithOtp uses atomic WHERE on ACCEPTED", () => {
    assert.match(SRC, /AND status IN \('ACCEPTED', 'PICKED_UP'\)/);
    assert.match(SRC, /pickupVerified: true/);
  });

  it("webhook runs boda fleet before role menus", () => {
    const bodaCall = WH.indexOf("await tryHandleBodaFleetMessage");
    const roleCall = WH.indexOf("await tryRoleMenu");
    assert.ok(bodaCall > 0 && roleCall > 0);
    assert.ok(bodaCall < roleCall, "boda must beat role menus so PICK UP SKN is not stolen");
  });
});
