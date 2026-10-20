/**
 * Unit check for WAHA webhook HMAC verification (no server required).
 * Run: node scripts/test-webhook-hmac.mjs
 */
import crypto from "node:crypto";
import assert from "node:assert/strict";

const key = "test-webhook-secret";
const body = Buffer.from(JSON.stringify({ event: "message", payload: { body: "menu" } }));
const good = crypto.createHmac("sha512", key).update(body).digest("hex");
const bad = crypto.createHmac("sha512", "wrong").update(body).digest("hex");

function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(String(a), "hex");
  const bb = Buffer.from(String(b), "hex");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

assert.equal(timingSafeEqualHex(good, good), true);
assert.equal(timingSafeEqualHex(good, bad), false);
assert.equal(timingSafeEqualHex(good, "00"), false);
console.log("ok — webhook HMAC helpers");
