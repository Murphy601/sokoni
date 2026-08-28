#!/usr/bin/env node
/**
 * Ops multi-agent graph smoke tests (no live LLM required).
 * Run: node scripts/test-agent-ops-graph.mjs
 */
import { routeSpecialist, detectEscalation, retrieveKnowledge } from "../src/services/agent-specialists.js";
import { runAgentGraph, SPECIALIST_TOOLS } from "../src/services/agent-graph.js";
import { executeTool, filterToolsForSpecialist } from "../src/services/ai-tools.js";
import { llmRouterMeta } from "../src/services/llm-router.js";
import { evaluateGoodwillVoucher } from "../src/services/agent-specialists.js";

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

assert("buyer lane for catalog query", routeSpecialist("headphones under 5000 in Nairobi") === "buyer");
assert(
  "seller lane for till onboarding",
  routeSpecialist("How do I register as a seller and link my M-Pesa Till?") === "seller"
);
assert(
  "dispute lane for damaged refund",
  routeSpecialist("My order SKN-1102 arrived damaged. I want my money back.") === "dispute"
);
assert(
  "logistics lane for where is package",
  routeSpecialist("Where is my package for Order SKN-4920?") === "logistics"
);

const fraud = detectEscalation("This seller scammed me — I am calling the police and suing Sokoni");
assert("fraud escalates high", fraud.escalate && fraud.severity === "high");

const onboarding = await executeTool("get_seller_onboarding", {});
assert("onboarding tool ok", onboarding.ok && (onboarding.steps || []).length >= 4);

const shipping = await executeTool("get_shipping_rates", {});
assert("shipping guide ok", shipping.ok && (shipping.howToSet || []).length >= 3);

const goodwillOk = evaluateGoodwillVoucher(200);
assert("goodwill under cap ok", goodwillOk.ok === true);
const goodwillHi = evaluateGoodwillVoucher(500);
assert("goodwill over cap needs human", goodwillHi.requiresHuman === true);

const knowledge = retrieveKnowledge("link my M-Pesa Till as a seller", { specialist: "seller", limit: 2 });
assert("seller knowledge hits onboarding/payouts", knowledge.length >= 1);

const graph = await runAgentGraph({
  text: "How do I set delivery price to KES 300 for Nairobi and KES 500 for upcountry?",
  phone: "",
});
assert("graph specialist seller", graph.specialist === "seller");
assert(
  "graph includes shipping tool",
  graph.tools.some((t) => t.tool === "get_shipping_rates")
);
assert("seller allowlist has payout tool", SPECIALIST_TOOLS.seller.includes("get_seller_payout"));

const filtered = filterToolsForSpecialist(
  [{ tool: "search_products" }, { tool: "get_seller_payout" }],
  SPECIALIST_TOOLS.seller
);
assert("filter drops buyer catalog on seller lane", filtered.length === 1 && filtered[0].tool === "get_seller_payout");

const meta = llmRouterMeta();
assert(
  "litellm-style router meta",
  String(meta.style || "").includes("litellm") &&
    Array.isArray(meta.providers) &&
    meta.temperature <= 0.35 &&
    meta.avoid?.includes("ollama_local_cpu_queue")
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nAll ops graph checks passed.");
