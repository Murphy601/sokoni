/**
 * Support contact grounding — deterministic card, store_info email, no invented contacts.
 */
import assert from "node:assert/strict";
import {
  isContactInfoIntent,
  isSupportIntent,
  executeTool,
  formatToolResultsForPrompt,
} from "../src/services/ai-tools.js";
import {
  formatSupportEmail,
  formatPhoneDisplay,
  supportContactCard,
} from "../src/services/trust-copy.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(formatSupportEmail(), "support@sokonimall.com");
assert.match(formatPhoneDisplay(), /\+254/);

assert.equal(isContactInfoIntent("what is sokoni support email?"), true);
assert.equal(isContactInfoIntent("how do I contact you"), true);
assert.equal(isContactInfoIntent("customer care phone number"), true);
assert.equal(isContactInfoIntent("I want sneakers under 3000"), false);

// Contact queries should not be classified as HITL-only support
assert.equal(isSupportIntent("support email please"), false);
assert.equal(isSupportIntent("talk to a human agent"), true);

const card = supportContactCard("whatsapp");
assert.match(card, /support@sokonimall\.com/);
assert.match(card, /\+254/);
assert.doesNotMatch(card, /sokoni\.co\.ke|kitengela|748\s*237/i);

const store = await executeTool("store_info", {}, {});
assert.equal(store.tool, "store_info");
assert.equal(store.supportEmail, "support@sokonimall.com");
assert.ok(store.phoneDisplay);

const block = formatToolResultsForPrompt([store]);
assert.match(block, /Support email:\s*support@sokonimall\.com/);

const agent = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/services/ai-agent.js"),
  "utf8"
);
assert.match(agent, /isContactInfoIntent/);
assert.match(agent, /supportContactCard/);
assert.match(agent, /contact card \(no LLM\)/);

console.log("ok: support contact grounding");
