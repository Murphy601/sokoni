#!/usr/bin/env node
/**
 * WhatsApp free-text must reach Sokoni Plug — not the old keyword confirm/list short-circuit.
 * Run: node scripts/test-wa-plug-routing.mjs
 */
import { handleProductRouter } from "../src/services/product-router.js";
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

const key = "test-wa-plug-routing";
assert(
  "product-router does not intercept fresh 'women dresses'",
  (await handleProductRouter(key, "women dresses")) === false
);
assert(
  "product-router does not intercept 'delmonte yoghurt'",
  (await handleProductRouter(key, "delmonte yoghurt")) === false
);
assert(
  "product-router does not intercept category question",
  (await handleProductRouter(key, "What categories do you have?")) === false
);

const cats = await runToolRouter("What categories do you have?");
assert("Plug tools still answer categories", cats.some((r) => r.tool === "browse_taxonomy"));

const yoghurt = await runToolRouter("delmonte yoghurt");
assert("Plug tools still search yoghurt", yoghurt.some((r) => r.tool === "search_products"));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
