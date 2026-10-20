/**
 * Phase 2 fee ledger sanity check — run: node scripts/test-cart-fees.mjs
 * Asserts commission is per line and M-Pesa fee is once on parent total.
 */
import {
  computeCartLineFees,
  computeCartParentTotals,
} from "../src/services/cart-orders.js";
import { mpesaTransactionFeeKes } from "../src/services/mpesa-transaction-fees.js";
import { PLATFORM_FEE_RATE } from "../src/services/shipping-tiers.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const productA = {
  id: "a",
  name: "Shoes",
  sellerNetKes: 1500,
  shippingKes: 0,
  freeShipping: true,
  deliveryMethod: "seller_express",
};
const productB = {
  id: "b",
  name: "Belt",
  sellerNetKes: 800,
  shippingKes: 0,
  freeShipping: true,
  deliveryMethod: "seller_express",
};
const productC = {
  id: "c",
  name: "Shirt",
  sellerNetKes: 1200,
  shippingKes: 0,
  freeShipping: true,
  deliveryMethod: "seller_express",
};

const l1 = computeCartLineFees(productA, 1);
const l2 = computeCartLineFees(productB, 1);
const l3 = computeCartLineFees(productC, 1);

assert(l1.transactionFeeKes === 0, "line 1 has no M-Pesa txn fee");
assert(l2.transactionFeeKes === 0, "line 2 has no M-Pesa txn fee");
assert(l3.transactionFeeKes === 0, "line 3 has no M-Pesa txn fee");

const expectedFee1 = Math.round(1500 * PLATFORM_FEE_RATE);
const expectedFee2 = Math.round(800 * PLATFORM_FEE_RATE);
const expectedFee3 = Math.round(1200 * PLATFORM_FEE_RATE);
assert(l1.platformFeeKes === expectedFee1, `line1 platform fee ${l1.platformFeeKes} === ${expectedFee1}`);
assert(l2.platformFeeKes === expectedFee2, `line2 platform fee ${l2.platformFeeKes} === ${expectedFee2}`);
assert(l3.platformFeeKes === expectedFee3, `line3 platform fee ${l3.platformFeeKes} === ${expectedFee3}`);

const parent = computeCartParentTotals([l1, l2, l3]);
const sumPlatform = expectedFee1 + expectedFee2 + expectedFee3;
assert(parent.platformFeeKes === sumPlatform, "parent platform fee = sum of line fees (not cart% once)");

const sumCharge = l1.chargeBeforeTxnKes + l2.chargeBeforeTxnKes + l3.chargeBeforeTxnKes;
const onceTxn = mpesaTransactionFeeKes(sumCharge);
assert(parent.transactionFeeKes === onceTxn, "one M-Pesa fee on parent total");
assert(parent.totalKes === sumCharge + onceTxn, "parent total = lines + one txn fee");

// Guard: commission must NOT equal 10% of grand total alone
const wrongCartCommission = Math.round(parent.totalKes * PLATFORM_FEE_RATE);
assert(parent.platformFeeKes !== wrongCartCommission, "commission is not 10% of cart STK total");

console.log("\nTotals:", parent);
if (process.exitCode) {
  console.error("\nCart fee tests FAILED");
} else {
  console.log("\nCart fee tests PASSED");
}
