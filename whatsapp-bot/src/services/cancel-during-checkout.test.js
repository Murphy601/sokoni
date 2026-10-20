import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const AUTO = readFileSync(new URL("./customer-automations.js", import.meta.url), "utf8");
const MENU = readFileSync(new URL("./menu.js", import.meta.url), "utf8");

/**
 * "cancel" at the quote screen must abandon the checkout and nothing else.
 * The wrong-order automation used to take it: it cancelled some earlier
 * order, told the buyer a refund was being processed for money never taken,
 * and pulled in an admin -- all while the order they meant to drop stayed put.
 */
describe("cancel during checkout", () => {
  it("lets a live checkout win over the wrong-order automation", () => {
    assert.match(AUTO, /const midCheckout = Boolean\(\s*getPendingOrder\(customerKey\) \|\| getPendingCart\(customerKey\)\s*\)/);
    assert.match(AUTO, /!midCheckout &&\s*\/\^cancel\$\/i\.test\(t\)/);
    assert.match(AUTO, /!midCheckout && \/\^\(replace\|correct\)\$\/i\.test\(t\)/);
  });

  it("still offers the wrong-order route when no checkout is open", () => {
    // The guard must not delete the feature -- a buyer with a delivered order
    // and a genuine problem still reaches it.
    assert.match(AUTO, /handleReplaceOrCancel\(customerKey, "CANCEL"/);
    assert.match(AUTO, /awaitingWrongOrderFix \|\|/);
  });

  it("the checkout's own cancel clears the pending order and says so", () => {
    const fn = MENU.slice(MENU.indexOf("export async function tryHandlePendingOrder"));
    const branch = fn.slice(0, fn.indexOf("const step ="));
    assert.match(branch, /cancel\|stop\|nevermind\|abort/);
    assert.match(branch, /clearPendingOrder\(to\)/);
    assert.match(branch, /Cancelled\. Type \*menu\*/);
  });

  it("never promises a refund from the checkout cancel path", () => {
    const fn = MENU.slice(MENU.indexOf("export async function cancelOrder"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.doesNotMatch(body, /refund|escrow/i, "unpaid cancel mentions a refund");
    assert.doesNotMatch(body, /notifyAdmin|setHumanHandoff/, "unpaid cancel pulls in an admin");
  });
});
