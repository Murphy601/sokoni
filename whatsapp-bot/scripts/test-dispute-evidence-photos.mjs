#!/usr/bin/env node
/**
 * Dispute evidence photos must not run visual catalog search.
 * Run: node scripts/test-dispute-evidence-photos.mjs
 */
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isFulfillmentComplaint,
  markAwaitingDisputeEvidence,
  clearAwaitingDisputeEvidence,
  isAwaitingDisputeEvidence,
  resolveDisputeEvidenceContext,
  shouldBlockCatalogImageSearch,
  tryHandleDisputeEvidencePhoto,
} from "../src/services/dispute-protocol.js";
import { getCustomerMeta } from "../src/services/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const sessionFile = path.join(__dirname, "..", "data", "dispute-evidence-sessions.json");

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
const phone = "254700099988";
clearAwaitingDisputeEvidence(key, phone);
assert("not awaiting initially", !isAwaitingDisputeEvidence(key, phone));

markAwaitingDisputeEvidence(key, { orderId: "SKN-5501", disputeId: 42, phone });
assert("awaiting after mark", isAwaitingDisputeEvidence(key, phone));
const meta = getCustomerMeta(key);
assert("stores order id", meta.disputeOrderId === "SKN-5501");
assert("legacy damage flag", meta.awaitingDamagePhoto === true);
assert("stores dispute id", Number(meta.disputeId) === 42);
assert("disk session written", existsSync(sessionFile));
const disk = JSON.parse(readFileSync(sessionFile, "utf8"));
assert("disk keyed by phone", Boolean(disk[phone]?.orderId === "SKN-5501"));
assert("block catalog search while awaiting", shouldBlockCatalogImageSearch(key, phone, ""));

// Resolve via phone digits alone (simulates @lid key flip with same phone)
clearAwaitingDisputeEvidence("other-key@lid", phone); // should not clear phone row if keys differ... 
// Re-mark and resolve without customerKey meta by using phone-only disk
markAwaitingDisputeEvidence("254700099988@lid", { orderId: "SKN-5501", disputeId: 42, phone });
const viaPhone = resolveDisputeEvidenceContext("254700099988@c.us", phone);
assert("resolve via shared phone disk", viaPhone.awaiting === true && viaPhone.orderId === "SKN-5501");

clearAwaitingDisputeEvidence(key, phone);
clearAwaitingDisputeEvidence("254700099988@lid", phone);
assert("cleared", !isAwaitingDisputeEvidence(key, phone));

// Photo with no order id still handled (blocks catalog search)
markAwaitingDisputeEvidence(key, { orderId: null, phone });
const handledNoOrder = await tryHandleDisputeEvidencePhoto(key, {
  hasMedia: true,
  mediaUrl: "https://example.invalid/x.jpg",
  mediaMimetype: "image/jpeg",
  text: "",
  phone,
});
assert("photo without order still handled", handledNoOrder === true);
assert("still awaiting after photo-without-order", isAwaitingDisputeEvidence(key, phone));
clearAwaitingDisputeEvidence(key, phone);

assert("damage complaint detected", isFulfillmentComplaint("Order arrived damaged"));
assert("wrong order is complaint", isFulfillmentComplaint("wrong order arrived"));
assert("block catalog when caption is complaint", shouldBlockCatalogImageSearch(key, phone, "this arrived damaged"));

const webhook = readFileSync(path.join(root, "whatsapp-bot/src/handlers/webhookHandler.js"), "utf8");
const evidenceIdx = webhook.indexOf("tryHandleDisputeEvidencePhoto");
const imageIdx = webhook.indexOf("tryHandleBuyerImageSearch");
const disputeCall = webhook.indexOf("if (await tryHandleFulfillmentDispute");
const automationCall = webhook.indexOf("if (await tryCustomerAutomation");
assert("webhook imports evidence handler", evidenceIdx > 0);
assert("evidence before image search", evidenceIdx > 0 && evidenceIdx < imageIdx);
assert("dispute protocol before image search", disputeCall > 0 && disputeCall < imageIdx);
assert("dispute before soft automations", disputeCall > 0 && disputeCall < automationCall);

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
assert("seller alert helper", protocol.includes("sendSellerDisputeAlert"));
assert("admin alert helper", protocol.includes("sendAdminDisputeAlert"));
assert("Evidence Received log", protocol.includes("Evidence Received"));

const imageSearch = readFileSync(
  path.join(root, "whatsapp-bot/src/services/image-search.js"),
  "utf8"
);
assert("image-search hard-gates disputes", imageSearch.includes("shouldBlockCatalogImageSearch"));

const disputes = readFileSync(path.join(root, "whatsapp-bot/src/services/disputes.js"), "utf8");
assert("getOpenDisputeForOrder exported", disputes.includes("export async function getOpenDisputeForOrder"));
assert("freezeOrderEscrow exported", disputes.includes("export async function freezeOrderEscrow"));

// cleanup test session file entries
clearAwaitingDisputeEvidence(key, phone);
try {
  if (existsSync(sessionFile)) unlinkSync(sessionFile);
} catch {
  /* ignore */
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\ndispute evidence photo checks OK");
