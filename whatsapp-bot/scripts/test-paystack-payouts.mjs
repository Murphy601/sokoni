/**
 * Paystack seller-payout helpers + wiring (no live Paystack calls).
 * Run: node scripts/test-paystack-payouts.mjs
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MPESA_DAILY_LIMIT_KES,
  MPESA_PER_TX_LIMIT_KES,
  buyerChargeEmail,
  parsePaystackChargeEvent,
  parsePaystackTransferEvent,
  paystackReference,
  remainingMpesaDailyKes,
  splitMpesaTransferChunks,
  toPaystackChargePhone,
  toPaystackMpesaAccount,
  verifyPaystackSignature,
} from "../src/services/paystack-transfers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

assert.equal(toPaystackMpesaAccount("254712345678"), "0712345678");
assert.equal(toPaystackMpesaAccount("+254712345678"), "0712345678");
assert.equal(toPaystackMpesaAccount("0712345678"), "0712345678");
assert.equal(toPaystackMpesaAccount("712345678"), "0712345678");
assert.equal(toPaystackMpesaAccount("254112345678"), "0112345678");
assert.equal(toPaystackMpesaAccount("not-a-phone"), "");
assert.equal(toPaystackChargePhone("254712345678"), "+254712345678");
assert.equal(toPaystackChargePhone("0712345678"), "+254712345678");
assert.equal(toPaystackChargePhone("712345678"), "+254712345678");
assert.equal(buyerChargeEmail({ id: "SKN-1001" }), "skn1001@pay.sokonimall.com");
assert.equal(buyerChargeEmail({ id: "SKN-1001", email: "buyer@example.com" }), "buyer@example.com");

assert.deepEqual(splitMpesaTransferChunks(150_000), [150_000]);
assert.deepEqual(splitMpesaTransferChunks(250_000), [250_000]);
assert.deepEqual(splitMpesaTransferChunks(400_000), [250_000, 150_000]);
assert.deepEqual(splitMpesaTransferChunks(500_000), [250_000, 250_000]);
assert.deepEqual(splitMpesaTransferChunks(0), []);
assert.equal(MPESA_PER_TX_LIMIT_KES, 250_000);
assert.equal(MPESA_DAILY_LIMIT_KES, 500_000);
assert.equal(remainingMpesaDailyKes(200_000), 300_000);
assert.equal(remainingMpesaDailyKes(500_000), 0);
assert.equal(remainingMpesaDailyKes(900_000), 0);

const ref = paystackReference({ withdrawId: "WD-2026-0001", orderId: "SKN-1001", chunkIndex: 1 });
assert.match(ref, /^[a-z0-9_-]+$/);
assert.ok(ref.length <= 80);

const secret = "sk_test_paystack_hmac";
const body = JSON.stringify({
  event: "transfer.success",
  data: {
    amount: 4000000,
    currency: "KES",
    reference: "wd-2026-0001-skn1001-c0",
    transfer_code: "TRF_test",
    status: "success",
    recipient: { recipient_code: "RCP_test" },
  },
});
const goodSig = crypto.createHmac("sha512", secret).update(body).digest("hex");
assert.equal(verifyPaystackSignature(body, goodSig, secret), true);
assert.equal(verifyPaystackSignature(body, "ab", secret), false);
assert.equal(verifyPaystackSignature(body, goodSig, "wrong"), false);

const parsed = parsePaystackTransferEvent(JSON.parse(body));
assert.equal(parsed.valid, true);
assert.equal(parsed.success, true);
assert.equal(parsed.amountKes, 40_000);
assert.equal(parsed.reference, "wd-2026-0001-skn1001-c0");

const failed = parsePaystackTransferEvent({
  event: "transfer.failed",
  data: { amount: 10000, reference: "x", recipient: { recipient_code: "RCP_x" } },
});
assert.equal(failed.failed, true);
assert.equal(failed.success, false);

const reversed = parsePaystackTransferEvent({ event: "transfer.reversed", data: { amount: 10000 } });
assert.equal(reversed.reversed, true);

const ignored = parsePaystackTransferEvent({ event: "charge.success", data: {} });
assert.equal(ignored.valid, false);

const chargeOk = parsePaystackChargeEvent({
  event: "charge.success",
  data: {
    amount: 45000,
    reference: "pay-skn1001-ab",
    status: "success",
    gateway_response: "Approved",
    metadata: { orderId: "SKN-1001" },
    customer: { phone: "+254712345678" },
  },
});
assert.equal(chargeOk.valid, true);
assert.equal(chargeOk.success, true);
assert.equal(chargeOk.amountKes, 450);
assert.equal(chargeOk.orderId, "SKN-1001");
assert.equal(parsePaystackChargeEvent({ event: "transfer.success", data: {} }).valid, false);

const prepaid = read("src/services/prepaid-checkout.js");
assert.match(prepaid, /initiatePaystackChargeForOrder/);
assert.match(prepaid, /resolveCollectRail/);

const settlements = read("src/services/settlements.js");
assert.match(settlements, /Lock ledger BEFORE the external API call/);
assert.match(settlements, /export async function initiateSettlementPaystack/);
assert.match(settlements, /export function applyPaystackTransferEvent/);
assert.match(settlements, /status = "disbursing"/);
assert.match(settlements, /paystack_failed/);

const withdraw = read("src/services/seller-withdrawals.js");
assert.match(withdraw, /rail === "paystack"/);
assert.match(withdraw, /initiateSettlementPaystack/);

const payments = read("src/routes/paymentsApi.js");
assert.match(payments, /handlePaystackWebhook/);
assert.match(payments, /x-paystack-signature/);
assert.match(payments, /parsePaystackChargeEvent/);
assert.match(payments, /resolveOrderFromPaystackCharge/);

const server = read("src/server.js");
assert.match(server, /\/api\/webhooks\/paystack/);

const security = read("src/middleware/security.js");
assert.match(security, /\/api\/webhooks\/paystack/);

const envExample = read(".env.example");
assert.match(envExample, /PAYSTACK_SECRET_KEY/);
assert.match(envExample, /SELLER_PAYOUT_RAIL/);
assert.match(envExample, /BUYER_PAY_RAIL/);
assert.match(envExample, /PAYSTACK_COLLECT/);
assert.match(envExample, /https:\/\/sokonimall.com\/checkout.html/);
assert.match(envExample, /https:\/\/bot.sokonimall.com\/api\/webhooks\/paystack/);

const checkoutApi = read("src/routes/checkoutApi.js");
assert.match(checkoutApi, /by-reference/);

const retain = readFileSync(path.join(root, "..", "scripts", "retain-order-for-withdraw-test.mjs"), "utf8");
assert.match(retain, /SKN-1013/);
assert.match(retain, /cancelledAt/);

console.log("ok — Paystack payout helpers + wiring present");
