/**
 * Smoke checks for Sokoni-only Ask AI conversation routing (no live LLM/API required).
 */
import assert from "node:assert/strict";
import {
  isGreetingIntent,
  isSupportIntent,
  isGuideIntent,
  isShoppingIntent,
  isSellerTopic,
  isOffTopicIntent,
  isSokoniConversation,
} from "../src/services/ai-tools.js";
import { offTopicRedirect } from "../src/services/ai-prompts.js";
import { enforceReplyBrevity, runAgentTurn } from "../src/services/ai-agent.js";

function ok(label) {
  console.log(`✓ ${label}`);
}

assert.equal(isGreetingIntent("hello"), true);
assert.equal(isShoppingIntent("hello"), false);
ok("greeting is conversational, not shopping");

assert.equal(isGreetingIntent("how are you"), true);
assert.equal(isGreetingIntent("How are you?"), true);
assert.equal(isShoppingIntent("how are you"), false);
assert.equal(isGuideIntent("how are you"), false);
assert.equal(isSokoniConversation("how are you"), true);
ok('"how are you" is small talk, not a product hunt');

assert.equal(isSupportIntent("I need to speak to support"), true);
assert.equal(isShoppingIntent("I need to speak to support"), false);
ok("support skips catalog hunt");

assert.equal(isGuideIntent("how do I buy on Sokoni"), true);
assert.equal(isGuideIntent("what do you sell"), true);
assert.equal(isShoppingIntent("how do I buy on Sokoni"), false);
ok("buy guide is conversational");

assert.equal(isSellerTopic("how do I list on Seller Hub"), true);
assert.equal(isShoppingIntent("how do I list on Seller Hub"), false);
assert.equal(isSokoniConversation("how do I list on Seller Hub"), true);
ok("seller hub help is Sokoni conversation");

assert.equal(isOffTopicIntent("what's the weather in Nairobi"), true);
assert.equal(isSokoniConversation("what's the weather in Nairobi"), false);
assert.equal(isOffTopicIntent("explain Sokoni escrow"), false);
ok("off-topic vs escrow scope");

assert.equal(isShoppingIntent("Electronics under 10000"), true);
assert.equal(isShoppingIntent("denim"), true);
assert.equal(isShoppingIntent("thanks"), false);
assert.equal(isShoppingIntent("i'm fine"), false);
ok("product hunts stay shopping; fillers do not");

const redirect = offTopicRedirect("web");
assert.match(redirect, /Sokoni/i);
assert.doesNotMatch(redirect, /weather/i);
ok("off-topic redirect stays on-brand");

const longChat = enforceReplyBrevity(
  "Seller Hub lets you manage Hub Drop-Offs, update stock units, share WhatsApp promo with your @handle, and check the M-Pesa Ledger. Open sokonimall.com/suppliers/list.html to get started. Need help with listing or payouts?",
  "web",
  { allowLonger: true }
);
assert.ok(longChat && longChat.split(/\s+/).length <= 110);
ok("conversational brevity allows longer web replies");

const howAreYou = await runAgentTurn({
  channel: "web",
  sessionKey: "smoke-chat",
  userMessage: "how are you",
  persist: false,
});
assert.ok(!(howAreYou.products || []).length);
assert.doesNotMatch(String(howAreYou.reply || ""), /Found \d+|live match|KES \d/i);
assert.match(String(howAreYou.reply || ""), /poa|Sokoni|Plug|ready|chat/i);
ok('"how are you" reply chats — no product suggestions');

console.log("\nAll Ask AI conversation smoke checks passed.");
