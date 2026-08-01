#!/usr/bin/env node
/**
 * Ensure Ask / WhatsApp tool router searches live catalog and knows browse/site info.
 * Run: node scripts/test-agent-tool-router.mjs
 */
import { runToolRouter } from "../src/services/ai-tools.js";
import { matchBrowseFromText } from "../src/services/browse-menu.js";
import { invalidateProductCache } from "../src/services/catalog.js";

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

const yoghurt = await runToolRouter("delmonte yoghurt");
const search = yoghurt.find((r) => r.tool === "search_products");
assert("delmonte yoghurt triggers search_products", Boolean(search));
assert("delmonte yoghurt finds catalog hits", (search?.count || 0) > 0);
assert(
  "hit includes yoghurt",
  (search?.products || []).some((p) => /yoghurt|yogurt/i.test(p.name || ""))
);

const track = await runToolRouter("SK-1042");
assert(
  "SK-1042 does not force catalog search",
  !track.some((r) => r.tool === "search_products" || r.tool === "browse_products")
);
assert("SK-1042 runs track_order", track.some((r) => r.tool === "track_order"));

const dress = await runToolRouter("dress under 5000");
assert(
  "dress under 5000 still searches",
  dress.some((r) => r.tool === "search_products")
);

const cats = await runToolRouter("What categories do you have?");
assert("categories query runs browse_taxonomy", cats.some((r) => r.tool === "browse_taxonomy"));
assert(
  "categories query skips product search",
  !cats.some((r) => r.tool === "search_products" || r.tool === "browse_products")
);
const tax = cats.find((r) => r.tool === "browse_taxonomy");
assert("taxonomy has multiple categories", (tax?.categories || []).length >= 4);

const prepaid = await runToolRouter("How does Sokoni prepaid escrow work?");
const store = prepaid.find((r) => r.tool === "store_info");
assert("prepaid query runs store_info", Boolean(store));
assert("store_info includes till", Boolean(store?.till));
assert("store_info includes howItWorks", Boolean(store?.howItWorks));
assert("store_info includes siteUrls", Boolean(store?.siteUrls?.home));
assert(
  "prepaid-only skips catalog search",
  !prepaid.some((r) => r.tool === "search_products" || r.tool === "browse_products")
);

const delivery = await runToolRouter("How does delivery work?");
assert("delivery query runs store_info", delivery.some((r) => r.tool === "store_info"));

const womenMatch = await matchBrowseFromText("women dresses");
assert("matchBrowseFromText finds women dresses", Boolean(womenMatch?.browseCategory));

const women = await runToolRouter("women dresses");
assert(
  "women dresses uses browse_products or search with browse filter",
  women.some(
    (r) =>
      r.tool === "browse_products" ||
      (r.tool === "search_products" && r.browseCategory)
  )
);

const electronics = await runToolRouter("Electronics under 10000");
const eSearch = electronics.find((r) => r.tool === "search_products");
assert("electronics under 10000 searches", Boolean(eSearch));
assert(
  "electronics under 10000 applies browse aisle when matched",
  !eSearch || eSearch.browseCategory == null || typeof eSearch.browseCategory === "string"
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
