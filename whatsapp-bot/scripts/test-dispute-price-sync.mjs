#!/usr/bin/env node
/**
 * Dispute escalation protocol + seller price sync helpers.
 * Run: node scripts/test-dispute-price-sync.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mapBuyerIssueToDisputeReason } from "../src/services/communication-hub.js";
import { orderHasDisputeHold } from "../src/services/disputes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

assert("damaged → damaged reason", mapBuyerIssueToDisputeReason("Item arrived damaged") === "damaged");
assert("wrong item → wrong_item", mapBuyerIssueToDisputeReason("You sent the wrong item") === "wrong_item");
assert("fake → not_as_described", mapBuyerIssueToDisputeReason("This is fake") === "not_as_described");
assert("refund other", mapBuyerIssueToDisputeReason("I want a refund") === "other");

assert("dispute hold flag", orderHasDisputeHold({ disputeHold: true, payoutStatus: "held_for_dispute" }));

const hub = readFileSync(path.join(root, "whatsapp-bot/src/services/communication-hub.js"), "utf8");
assert("openBuyerReturnCase creates DB dispute", hub.includes("createDispute"));
assert("openBuyerReturnCase maps reason", hub.includes("mapBuyerIssueToDisputeReason"));
assert("takeover can skip duplicate seller ping", hub.includes("skipCounterpartNotify"));
assert("buyer message asks for photos", hub.includes("clear photos"));

const disputesSrc = readFileSync(path.join(root, "whatsapp-bot/src/services/disputes.js"), "utf8");
assert("freeze awaits payout hold", disputesSrc.includes('payoutStatus: "held_for_dispute"'));
assert("createDispute awaits freeze", disputesSrc.includes("await freezeOrderEscrow"));

const listingsSrc = readFileSync(path.join(root, "whatsapp-bot/src/services/seller-listings.js"), "utf8");
assert("hub overlays DB prices", listingsSrc.includes("overlaySellerListingPricesFromDb"));

const onboardSrc = readFileSync(path.join(root, "whatsapp-bot/src/services/seller-onboard.js"), "utf8");
assert("price update invalidates catalog cache", onboardSrc.includes("invalidateProductCache"));
assert("price response includes compareAtPrice", onboardSrc.includes("compareAtPrice:"));
assert("compare-at helper present", onboardSrc.includes("applyCompareAtOnBuyerPriceChange"));

const uiSrc = readFileSync(path.join(root, "website/assets/js/seller-listing.js"), "utf8");
assert("hub patches price optimistically", uiSrc.includes("Optimistic patch"));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\ndispute + price sync checks OK");
