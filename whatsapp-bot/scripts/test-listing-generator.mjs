#!/usr/bin/env node
/** Unit checks for Phase 4 listing generator (no API calls). */
import {
  enrichManualDraft,
  resolveBrowsePath,
  parseCost,
  inferCategory,
  finalizeListingDraft,
} from "../src/services/listing-generator.js";

async function main() {
  const cost = parseCost("130 ksh women sandals");
  if (cost !== 130) throw new Error(`parseCost failed: ${cost}`);

  const cat = inferCategory("Samsung Galaxy phone case");
  if (cat !== "phones-tablets") throw new Error(`inferCategory failed: ${cat}`);

  const browse = await resolveBrowsePath({
    category: "fashion",
    subcategory: "shoes",
    name: "Women flat sandals",
  });
  if (browse.browse !== "women" || browse.sub !== "shoes") {
    throw new Error(`resolveBrowsePath failed: ${JSON.stringify(browse)}`);
  }

  const manual = await enrichManualDraft({
    name: "Men hoodie black",
    category: "fashion",
    sourcePriceKes: 800,
  });
  if (!manual.browseCategory || !manual.priceKes) {
    throw new Error(`enrichManualDraft failed: ${JSON.stringify(manual)}`);
  }

  const finalized = await finalizeListingDraft(
    {
      name: "Test item",
      sourcePriceKes: 500,
      category: "fashion",
      subcategory: "shoes",
    },
    "500 ksh"
  );
  if (finalized.priceKes <= 500) throw new Error("finalizeListingDraft retail too low");

  console.log("OK: Phase 4 listing-generator helpers");
  console.log("  browse:", browse.browse, browse.sub);
  console.log("  manual retail:", manual.priceKes);
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
