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
assert.match(agent, /max_tokens: maxTokens/);
assert.match(agent, /maxTokens = channel === "web" \? 120 : 80/);
assert.match(agent, /temperature: 0\.2/);
assert.match(agent, /frequency_penalty: 0\.5/);
assert.match(agent, /enforceReplyBrevity/);
assert.match(agent, /Found \*\$\{n\}\* match/);
assert.match(webhook, /claimInboundMessageId/);
assert.match(webhook, /duplicate blocked/);

const { enforceReplyBrevity } = await import("../src/services/ai-agent.js");
const long =
  "Hello! I hope you are having a wonderful day. Thank you for choosing Sokoni. " +
  "I would be delighted to assist you with finding the perfect sneakers today. " +
  "We have many options across several categories and price points. " +
  "Would you also like to know about shipping, returns, or our escrow policy? " +
  "Let me know if you need anything else!";
const short = enforceReplyBrevity(long, "whatsapp");
assert.ok(short);
assert.ok(short.split(/\s+/).length <= 40, `word count ${short.split(/\s+/).length}: ${short}`);
assert.ok(!/hope you are having/i.test(short));
assert.ok(!/let me know if you need/i.test(short));

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
