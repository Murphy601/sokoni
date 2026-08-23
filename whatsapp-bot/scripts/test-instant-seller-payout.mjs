/**
 * Static checks for instant Ready-on-delivery + withdraw B2C wiring.
 * Run: node scripts/test-instant-seller-payout.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const settlements = read("src/services/settlements.js");
assert.match(settlements, /export function creditSellerWalletAfterDelivery/);
assert.match(settlements, /export function escrowHoldBusinessDays/);

const escrow = read("src/services/escrow-automation.js");
assert.match(escrow, /creditSellerWalletAfterDelivery/);
assert.match(escrow, /escrowHoldBusinessDays/);

const withdraw = read("src/services/seller-withdrawals.js");
assert.match(withdraw, /resolvePayoutRail/);
assert.match(withdraw, /initiateSettlementPaystack/);
assert.match(withdraw, /initiateSettlementB2C/);

const config = read("src/config.js");
assert.match(config, /escrowHoldBusinessDays/);
assert.match(config, /withdrawInstantB2c/);
assert.match(config, /PAYSTACK_SECRET_KEY/);
assert.match(config, /payoutRail/);
assert.match(config, /collectRail/);
assert.match(config, /PAYSTACK_ONLY/);
assert.match(config, /PAYSTACK_TRANSFERS/);

const prepaid = read("src/services/prepaid-checkout.js");
assert.match(prepaid, /initiatePaystackMpesaCharge/);

const api = read("src/routes/adminCommandApi.js");
assert.match(api, /payb2c/);

const ui = readFileSync(path.join(root, "..", "website/assets/js/admin-command.js"), "utf8");
assert.match(ui, /runPayB2C/);
assert.match(ui, /readyPayouts/);

console.log("ok — instant seller payout wiring present");
