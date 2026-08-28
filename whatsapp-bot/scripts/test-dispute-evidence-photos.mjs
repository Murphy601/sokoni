#!/usr/bin/env node
/**
 * Dispute evidence photos must not run visual catalog search.
 * Run: node scripts/test-dispute-evidence-photos.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isFulfillmentComplaint,
  markAwaitingDisputeEvidence,
  clearAwaitingDisputeEvidence,
  isAwaitingDisputeEvidence,
  tryHandleDisputeEvidencePhoto,
} from "../src/services/dispute-protocol.js";
import { setCustomerMeta, getCustomerMeta } from "../src/services/session.js";

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

const key = "254700099988@c.us";
clearAwaitingDisputeEvidence(key);
assert("not awaiting initially", !isAwaitingDisputeEvidence(key));

markAwaitingDisputeEvidence(key, { orderId: "SKN-5501", disputeId: 42 });
assert("awaiting after mark", isAwaitingDisputeEvidence(key));
const meta = getCustomerMeta(key);
assert("stores order id", meta.disputeOrderId === "SKN-5501");
assert("legacy damage flag", meta.awaitingDamagePhoto === true);
assert("stores dispute id", Number(meta.disputeId) === 42);

clearAwaitingDisputeEvidence(key);
assert("cleared", !isAwaitingDisputeEvidence(key));

// Photo with no order id still handled (blocks catalog search)
markAwaitingDisputeEvidence(key, { orderId: null });
const handledNoOrder = await tryHandleDisputeEvidencePhoto(key, {
  hasMedia: true,
  mediaUrl: "https://example.invalid/x.jpg",
  mediaMimetype: "image/jpeg",
  text: "",
  phone: "254700099988",
});
assert("photo without order still handled", handledNoOrder === true);
assert("still awaiting after photo-without-order", isAwaitingDisputeEvidence(key));
clearAwaitingDisputeEvidence(key);

assert("damage complaint detected", isFulfillmentComplaint("Order arrived damaged"));

const webhook = readFileSync(path.join(root, "whatsapp-bot/src/handlers/webhookHandler.js"), "utf8");
const evidenceIdx = webhook.indexOf("tryHandleDisputeEvidencePhoto");
const imageIdx = webhook.indexOf("tryHandleBuyerImageSearch");
const disputeIdx = webhook.indexOf("tryHandleFulfillmentDispute");
assert("webhook imports evidence handler", evidenceIdx > 0);
assert("evidence before image search", evidenceIdx > 0 && evidenceIdx < imageIdx);
assert("dispute protocol before image search", disputeIdx > 0 && disputeIdx < imageIdx);

const automations = readFileSync(
  path.join(root, "whatsapp-bot/src/services/customer-automations.js"),
  "utf8"
);
assert(
  "soft damage path removed from automations",
  !/awaitingDamagePhoto:\s*true/.test(automations)
);

const protocol = readFileSync(
  path.join(root, "whatsapp-bot/src/services/dispute-protocol.js"),
  "utf8"
);
assert("protocol marks awaiting evidence", protocol.includes("markAwaitingDisputeEvidence"));
assert("protocol hosts evidence under catalog-images", protocol.includes("dispute_ev_"));

const disputes = readFileSync(path.join(root, "whatsapp-bot/src/services/disputes.js"), "utf8");
assert("getOpenDisputeForOrder exported", disputes.includes("export async function getOpenDisputeForOrder"));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\ndispute evidence photo checks OK");
