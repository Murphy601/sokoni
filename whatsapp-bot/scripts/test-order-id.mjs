#!/usr/bin/env node
/**
 * Smoke tests: SKN / SK order id normalize + extract.
 * Run: node scripts/test-order-id.mjs
 */
import {
  normalizeOrderId,
  extractOrderIdFromText,
  isSokoniOrderId,
} from "../src/lib/order-id.js";

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

assert("legacy SK", normalizeOrderId("sk-1042") === "SK-1042");
assert("bare digits → SKN", normalizeOrderId("1042") === "SKN-1042");
assert("SKN parent", normalizeOrderId("skn-1002") === "SKN-1002");
assert("SKN child", normalizeOrderId("SKN-1002-1") === "SKN-1002-1");
assert("SKN child must NOT become SK-10021", normalizeOrderId("SKN-1002-1") !== "SK-10021");
assert("missing hyphen SKN", normalizeOrderId("SKN1002") === "SKN-1002");
assert("missing hyphen SKN child", normalizeOrderId("skn1002-1") === "SKN-1002-1");
assert("missing hyphen SK", normalizeOrderId("SK1042") === "SK-1042");
assert("extract from sentence", extractOrderIdFromText("track SKN-1002-1 please") === "SKN-1002-1");
assert("extract prefers SKN over noise", extractOrderIdFromText("HELP SKN-88-2 now") === "SKN-88-2");
assert("extract legacy", extractOrderIdFromText("my order is SK-99") === "SK-99");
assert("isSokoniOrderId child", isSokoniOrderId("SKN-1002-1"));
assert("isSokoniOrderId parent", isSokoniOrderId("SKN-1002"));
assert("isSokoniOrderId legacy", isSokoniOrderId("SK-1042"));
assert("reject garbage", !isSokoniOrderId("HELLO"));
assert("null safe", normalizeOrderId(null) === null);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
