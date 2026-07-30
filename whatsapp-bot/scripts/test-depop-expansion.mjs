#!/usr/bin/env node
/**
 * Unit checks for Depop expansion helpers (no live DB required).
 * Run: node scripts/test-depop-expansion.mjs
 */
import { MAX_PHOTOS } from "../src/services/seller-listings.js";
import { feedMeta } from "../src/services/feed-ranking.js";
import { jsonToDbProduct, rowToCatalogProduct } from "../src/db/product-mapper.js";

let failed = 0;

function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

assert("MAX_PHOTOS is 8", MAX_PHOTOS === 8);

const meta = feedMeta();
assert("feed meta exposes following mode", Array.isArray(meta.modes) && meta.modes.includes("following"));

const dbRow = jsonToDbProduct({
  id: "fa-test-1",
  name: "Vintage tee",
  category: "fashion",
  size: "M",
  pitToPitIn: 20.5,
  lengthIn: 27,
  waistIn: 30,
  condition: "like_new",
  priceKes: 1200,
  isSecondhand: true,
});
assert("jsonToDbProduct maps size_label", dbRow.size_label === "M");
assert("jsonToDbProduct maps pit_to_pit_in", dbRow.pit_to_pit_in === 20.5);
assert("jsonToDbProduct maps length_in", dbRow.length_in === 27);
assert("jsonToDbProduct maps waist_in", dbRow.waist_in === 30);

const catalog = rowToCatalogProduct({
  id: "fa-test-1",
  title: "Vintage tee",
  category: "fashion",
  size_label: "M",
  pit_to_pit_in: 20.5,
  length_in: 27,
  waist_in: 30,
  condition: "like_new",
  is_secondhand: true,
  price_kes: 1200,
  in_stock: true,
  is_sold: false,
  legacy_json: {},
});
assert("rowToCatalogProduct restores pitToPitIn", catalog.pitToPitIn === 20.5);
assert("rowToCatalogProduct restores lengthIn", catalog.lengthIn === 27);
assert("rowToCatalogProduct restores waistIn", catalog.waistIn === 30);

function normalizeSocialUrl(value, { platforms = [] } = {}) {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const handleOnly = raw.replace(/^@+/, "").trim();
  if (platforms.includes("instagram")) {
    if (/^https?:\/\//i.test(raw)) {
      if (!/instagram\.com/i.test(raw)) return { error: "invalid_social_url" };
      return raw;
    }
    if (/^[a-zA-Z0-9._]{1,30}$/.test(handleOnly)) return `https://instagram.com/${handleOnly}`;
    return { error: "invalid_social_url" };
  }
  if (platforms.includes("tiktok")) {
    if (/^https?:\/\//i.test(raw)) {
      if (!/tiktok\.com/i.test(raw)) return { error: "invalid_social_url" };
      return raw;
    }
    if (/^[a-zA-Z0-9._]{2,24}$/.test(handleOnly)) return `https://www.tiktok.com/@${handleOnly}`;
    return { error: "invalid_social_url" };
  }
  return raw;
}

assert(
  "instagram handle becomes URL",
  normalizeSocialUrl("@nairobi.thrift", { platforms: ["instagram"] }) ===
    "https://instagram.com/nairobi.thrift"
);
assert(
  "tiktok handle becomes URL",
  normalizeSocialUrl("ke.vintage", { platforms: ["tiktok"] }) === "https://www.tiktok.com/@ke.vintage"
);
assert(
  "rejects non-instagram URL",
  normalizeSocialUrl("https://facebook.com/x", { platforms: ["instagram"] })?.error ===
    "invalid_social_url"
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
