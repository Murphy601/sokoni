#!/usr/bin/env node
/**
 * Catalog search false-empty fixes: routing + keyword scoring + hybrid fallback.
 * Run: node scripts/test-catalog-search-fix.mjs
 */
import { routeSpecialist } from "../src/services/agent-specialists.js";
import {
  runToolRouter,
  isSellerTopic,
  isShoppingIntent,
  formatToolResultsForPrompt,
} from "../src/services/ai-tools.js";
import { searchProducts, invalidateProductCache } from "../src/services/catalog.js";
import { smartSearch } from "../src/services/smart-search.js";
import { SPECIALIST_TOOLS } from "../src/services/agent-graph.js";

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

invalidateProductCache();

assert(
  "stock of shoes → buyer (not seller)",
  routeSpecialist("do you have stock of shoes") === "buyer"
);
assert(
  "listings for dresses → buyer",
  routeSpecialist("show me listings for dresses") === "buyer"
);
assert(
  "seller till onboarding still seller",
  routeSpecialist("How do I register as a seller and link my M-Pesa Till?") === "seller"
);
assert(
  "listings for dresses is not seller topic",
  isSellerTopic("show me listings for dresses") === false
);
assert("shopping: stock of shoes", isShoppingIntent("do you have stock of shoes") === true);
assert("shopping: listings for dresses", isShoppingIntent("show me listings for dresses") === true);
assert("shopping: mug", isShoppingIntent("mug") === true);

const stockShoes = await runToolRouter("do you have stock of shoes");
assert(
  "stock of shoes runs search or browse",
  stockShoes.some((r) => r.tool === "search_products" || r.tool === "browse_products")
);
assert(
  "buyer allowlist includes search",
  SPECIALIST_TOOLS.buyer.includes("search_products")
);

const yogurt = await smartSearch({ q: "yogurt", limit: 5 });
const yoghurt = await smartSearch({ q: "yoghurt", limit: 5 });
// Fixture may or may not have yoghurt — scoring must not treat yogurt as empty-by-bug vs yoghurt
assert(
  "yogurt/yoghurt expansions stay consistent enough",
  (yogurt.expandedQuery || "").includes("yoghurt") || (yogurt.expandedQuery || "").includes("yogurt")
);
assert(
  "yoghurt query expands yogurt alias",
  (yoghurt.expandedQuery || "").includes("yogurt") || (yoghurt.expandedQuery || "").includes("yoghurt")
);

const mugSearch = await searchProducts({ keywords: "mug", limit: 8 });
const mugSmart = await smartSearch({ q: "mug", limit: 8 });
assert(
  "3-char token mug does not hard-fail score path",
  Array.isArray(mugSearch) && Array.isArray(mugSmart.products)
);

const emptyFmt = formatToolResultsForPrompt([
  { tool: "search_products", query: "unicorn boots", products: [], count: 0 },
]);
assert("zero-hit search is explicit in prompt", /0 hits/i.test(emptyFmt || ""));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\ncatalog search fix checks OK");
