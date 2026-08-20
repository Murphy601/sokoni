/**
 * Static + unit checks: short AI replies + WAHA inbound dedupe.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const prompts = readFileSync(path.join(root, "src/services/ai-prompts.js"), "utf8");
const agent = readFileSync(path.join(root, "src/services/ai-agent.js"), "utf8");
const webhook = readFileSync(path.join(root, "src/handlers/webhookHandler.js"), "utf8");

assert.match(prompts, /SOKONI_MASTER_RULES/);
assert.match(prompts, /MAXIMUM LENGTH/);
assert.match(prompts, /SINGLE-MESSAGE PRINCIPLE/);
assert.match(prompts, /NO GREETING FLUFF/);
assert.match(prompts, /under 40 words/);
assert.match(prompts, /NEVER quote|OUTPUT ONLY THE CUSTOMER ANSWER/i);
assert.match(agent, /max_tokens: maxTokens/);
assert.match(agent, /maxTokens = allowLonger/);
assert.match(agent, /temperature: 0\.2/);
assert.match(agent, /frequency_penalty: 0\.5/);
assert.match(agent, /enforceReplyBrevity/);
assert.match(agent, /looksLikeInstructionLeak/);
assert.match(agent, /Found \*\$\{n\}\* match/);
assert.match(webhook, /claimInboundMessageId/);
assert.match(webhook, /duplicate blocked/);

const { enforceReplyBrevity, looksLikeInstructionLeak } = await import("../src/services/ai-agent.js");
const long =
  "Hello! I hope you are having a wonderful day. Thank you for choosing Sokoni. " +
  "I would be delighted to assist you with finding the perfect sneakers today. " +
  "We have many options across several categories and price points. " +
  "Would you also like to know about shipping, returns, or our escrow policy? " +
  "Let me know if you need anything else!";
const short = enforceReplyBrevity(long, "whatsapp");
assert.ok(short);
assert.ok(short.split(/\s+/).length <= 45, `word count ${short.split(/\s+/).length}: ${short}`);
assert.ok(!/hope you are having/i.test(short));
assert.ok(!/let me know if you need/i.test(short));

const leak =
  "We need to answer concisely, max 2-3 sentences, under 60 words, no fluff, direct, include bold for order IDs etc if needed. Must not add unasked follow-ups. Provide explanation of escrow: funds held until delivery confirmed, paid via M-Pesa STK, etc.";
assert.equal(looksLikeInstructionLeak(leak), true);
assert.equal(enforceReplyBrevity(leak, "web"), null);

const escrowOk =
  "You pay by M-Pesa STK when you order; Sokoni holds that money in prepaid escrow until delivery is confirmed, then releases the seller payout. No COD — never send money to personal tills.";
assert.ok(enforceReplyBrevity(escrowOk, "web"));
assert.ok(!looksLikeInstructionLeak(escrowOk));

const {
  claimInboundMessageId,
  resetInboundMessageDedupe,
  inboundDedupeSize,
} = await import("../src/services/message-dedupe.js");

resetInboundMessageDedupe();
assert.equal(claimInboundMessageId("wamid.TEST1"), false);
assert.equal(claimInboundMessageId("wamid.TEST1"), true);
assert.equal(claimInboundMessageId("wamid.TEST2"), false);
assert.ok(inboundDedupeSize() >= 2);
assert.equal(claimInboundMessageId(""), false);

console.log("ok: concise AI prompts/caps + WAHA message dedupe");
