#!/usr/bin/env node
/** Unit checks for Phase 4 listing moderation helpers (no API / filesystem writes). */
import {
  scanListingLocally,
  summarizeModeration,
  labelForFlag,
} from "../src/services/listing-moderation.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  assert(labelForFlag("off_platform_contact") === "Off-platform contact", "label off_platform");
  assert(labelForFlag("missing_image") === "Missing image", "label missing_image");

  const clean = scanListingLocally({
    name: "Women sandals burgundy",
    description: "Flat sandals. Prepaid across Kenya.",
    sourcePriceKes: 500,
    imageUrl: "catalog-images/x.jpg",
  });
  assert(clean.passed === true, "clean listing should pass");
  assert(clean.flags.length === 0, "clean listing flags empty");

  const flagged = scanListingLocally({
    name: "Sneakers",
    description: "DM me on WhatsApp +254712345678",
    sourcePriceKes: 1200,
    imageUrl: "catalog-images/y.jpg",
  });
  assert(flagged.passed === false, "off-platform should fail");
  assert(flagged.flags.includes("off_platform_contact"), "expect off_platform_contact");

  const summary = summarizeModeration(
    { status: "hidden", flags: flagged.flags, reason: "" },
    { inStock: false }
  );
  assert(summary.status === "hidden", "summary hidden");
  assert(summary.labels.includes("Off-platform contact"), "human label");
  assert(String(summary.sellerHint).length > 10, "seller hint present");

  const restored = summarizeModeration({ status: "live", flags: [] }, { inStock: true });
  assert(restored.status === "live", "live status");
  assert(!restored.sellerHint, "no hint when live");

  console.log("OK: Phase 4 listing-moderation helpers");
  console.log("  flagged flags:", flagged.flags.join(", "));
  console.log("  summary:", summary.reason);
}

main();
