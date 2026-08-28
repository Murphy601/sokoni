#!/usr/bin/env node
/**
 * Deterministic dispute protocol — must not depend on LLM.
 * Run: node scripts/test-dispute-protocol-hard.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isFulfillmentComplaint,
  resolveDisputeOrderCandidate,
  runFulfillmentDisputeProtocol,
} from "../src/services/dispute-protocol.js";

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

assert("damaged is complaint", isFulfillmentComplaint("my order arrived damaged"));
assert("wrong item is complaint", isFulfillmentComplaint("you sent the wrong item"));
assert("refund is complaint", isFulfillmentComplaint("I want a refund for SKN-1001"));
assert("shoes browse is not complaint", !isFulfillmentComplaint("do you have shoes"));
assert("seller listing help is not complaint", !isFulfillmentComplaint("how do I create a listing"));

const resolved = resolveDisputeOrderCandidate({ phone: "254700000000", customerKey: "254700000000" });
assert("resolve returns shape", resolved && Array.isArray(resolved.candidates));

const needId = await runFulfillmentDisputeProtocol({
  text: "item arrived damaged",
  phone: "254700000099",
  customerKey: "254700000099@c.us",
});
assert("handled without LLM", needId.handled === true);
assert("asks for SKN when no orders", needId.needsOrderId === true || needId.ok === false);
assert("structured follow-up text", /SKN|Dispute|freeze|ticket|order/i.test(needId.message || ""));

const webhook = readFileSync(path.join(root, "whatsapp-bot/src/handlers/webhookHandler.js"), "utf8");
assert("webhook hooks dispute before AI", webhook.includes("tryHandleFulfillmentDispute"));

const agent = readFileSync(path.join(root, "whatsapp-bot/src/services/ai-agent.js"), "utf8");
assert("ai-agent skips LLM on dispute protocol", agent.includes("dispute protocol (no LLM)"));
assert("ai-agent returns dispute message directly", agent.includes("disputeProtocol: true"));

const tools = readFileSync(path.join(root, "whatsapp-bot/src/services/ai-tools.js"), "utf8");
assert("tool router uses dispute protocol", tools.includes("runFulfillmentDisputeProtocol"));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nhard dispute protocol checks OK");
