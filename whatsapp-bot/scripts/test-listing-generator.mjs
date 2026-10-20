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
  // Seller-net model: priceKes mirrors what the seller receives; buyer total is applied later.
  if (finalized.sellerNetKes !== 500 || finalized.priceKes !== 500) {
    throw new Error(
      `finalizeListingDraft seller-net mismatch: ${JSON.stringify({
        sellerNetKes: finalized.sellerNetKes,
        priceKes: finalized.priceKes,
      })}`
    );
  }
  if (!finalized.browseCategory) {
    throw new Error(`finalizeListingDraft missing browseCategory: ${JSON.stringify(finalized)}`);
  }
  if (finalized.condition !== "gently_used") {
    throw new Error(`expected thrift default gently_used, got ${finalized.condition}`);
  }

  // Caption price must win over a wrong sticker OCR; invalid browse remaps; aliases normalize.
  const visionish = await finalizeListingDraft(
    {
      name: "Black Adidas Samba",
      sellerNetKes: 9999,
      category: "fashion",
      subcategory: "shoes",
      browseCategory: "fashion",
      browseSubCategory: "sneakers",
      condition: "good",
      brand: "Unknown",
      color: "black",
      size: "UK 9",
      tags: ["vintage", "#streetwear", ""],
      pitToPitIn: null,
      lengthIn: "12.5",
    },
    "4500 ksh men sneakers"
  );
  if (visionish.sellerNetKes !== 4500) {
    throw new Error(`caption price should win: got ${visionish.sellerNetKes}`);
  }
  if (visionish.browseCategory !== "men" || visionish.browseSubCategory !== "sneakers") {
    throw new Error(`browse remap failed: ${visionish.browseCategory}/${visionish.browseSubCategory}`);
  }
  if (visionish.condition !== "gently_used") {
    throw new Error(`condition alias failed: ${visionish.condition}`);
  }
  if (visionish.brand) {
    throw new Error(`placeholder brand should be cleared: ${visionish.brand}`);
  }
  if (!visionish.tags.includes("streetwear") || visionish.tags.length > 5) {
    throw new Error(`tags normalize failed: ${JSON.stringify(visionish.tags)}`);
  }
  if (visionish.lengthIn !== 12.5) {
    throw new Error(`lengthIn normalize failed: ${visionish.lengthIn}`);
  }

  console.log("OK: Phase 4 listing-generator helpers");
  console.log("  browse:", browse.browse, browse.sub);
  console.log("  manual seller-net:", manual.sellerNetKes ?? manual.priceKes);
  console.log("  finalized seller-net:", finalized.sellerNetKes);
  console.log("  visionish:", visionish.browseCategory, visionish.browseSubCategory, visionish.sellerNetKes);
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
