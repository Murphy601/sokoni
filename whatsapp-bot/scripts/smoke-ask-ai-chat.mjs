/**
 * Smoke checks: Sokoni AI answers marketplace questions without dumping stock on chat.
 */
import assert from "node:assert/strict";
import {
  isGreetingIntent,
  isGuideIntent,
  isShoppingIntent,
  isSellerTopic,
  isOffTopicIntent,
  runToolRouter,
} from "../src/services/ai-tools.js";
import { runAgentTurn } from "../src/services/ai-agent.js";

function ok(label) {
  console.log(`✓ ${label}`);
}

assert.equal(isGreetingIntent("how are you"), true);
assert.equal(isShoppingIntent("how are you"), false);
assert.equal(isShoppingIntent("I need help with escrow"), false);
assert.equal(isShoppingIntent("how do seller payouts work"), false);
assert.equal(isShoppingIntent("can I dispute an order"), false);
assert.equal(isShoppingIntent("what categories do you have"), false);
assert.equal(isShoppingIntent("denim"), true);
assert.equal(isShoppingIntent("looking for red dresses"), true);
assert.equal(isShoppingIntent("Electronics under 10000"), true);
ok("shopping intent only for real product hunts");

assert.equal(isGuideIntent("how do I buy on Sokoni"), true);
assert.equal(isSellerTopic("how do I list on Seller Hub"), true);
assert.equal(isOffTopicIntent("what's the weather"), true);
ok("guide / seller / off-topic intents");

async function toolsFor(msg) {
  const tools = await runToolRouter(msg);
  return {
    store: tools.some((t) => t.tool === "store_info"),
    catalog: tools.some((t) => t.tool === "search_products" || t.tool === "browse_products"),
    tax: tools.some((t) => t.tool === "browse_taxonomy"),
  };
}

const escrowTools = await toolsFor("how does prepaid escrow work on Sokoni");
assert.equal(escrowTools.store, true);
assert.equal(escrowTools.catalog, false);
ok("escrow question gets store_info, not catalog search");

const sellerTools = await toolsFor("how do seller payouts work");
assert.equal(sellerTools.store, true);
assert.equal(sellerTools.catalog, false);
ok("seller payout question is conversational tools only");

const greetTools = await toolsFor("how are you");
assert.equal(greetTools.catalog, false);
ok("greeting does not search catalog");

const shopTools = await toolsFor("denim");
assert.equal(shopTools.catalog, true);
ok("denim still searches live catalog");

const cases = [
  "how are you",
  "how does escrow work",
  "how do I sell on Sokoni",
  "do you deliver countrywide",
  "can I open a dispute",
  "what is Seller Hub",
  "how do I create an account",
];

for (const msg of cases) {
  const r = await runAgentTurn({
    channel: "web",
    sessionKey: "smoke-full",
    userMessage: msg,
    persist: false,
  });
  assert.equal(!!r.offTopic, false, msg);
  assert.ok(!(r.products || []).length, `no product cards for: ${msg}`);
  assert.doesNotMatch(String(r.reply || ""), /Found \d+ live/i, msg);
  assert.ok(String(r.reply || "").length > 20, msg);
  console.log(`✓ answers without product dump: ${msg}`);
}

const weather = await runAgentTurn({
  channel: "web",
  sessionKey: "smoke-full",
  userMessage: "what's the weather in Nairobi",
  persist: false,
});
assert.equal(weather.offTopic, true);
ok("weather still redirected");

console.log("\nAll full-converse smoke checks passed.");
