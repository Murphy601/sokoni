#!/usr/bin/env node
/**
 * Ensure Ask / WhatsApp tool router searches live catalog for brand/item queries.
 * Run: node scripts/test-agent-tool-router.mjs
 */
import { runToolRouter } from "../src/services/ai-tools.js";
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
  !track.some((r) => r.tool === "search_products")
);
assert("SK-1042 runs track_order", track.some((r) => r.tool === "track_order"));

const dress = await runToolRouter("dress under 5000");
assert(
  "dress under 5000 still searches",
  dress.some((r) => r.tool === "search_products")
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
