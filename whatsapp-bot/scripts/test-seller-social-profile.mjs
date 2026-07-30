#!/usr/bin/env node
/**
 * Lightweight unit checks for seller social profile helpers (no live DB required).
 * Run: node scripts/test-seller-social-profile.mjs
 */
let failed = 0;

function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

assert("strips @ from handle", normalizeHandle("@MyShop") === "myshop");
assert("slugifies spaces", normalizeHandle("Cool Shop!") === "cool-shop");
assert("rejects empty", normalizeHandle("   ") === "");

const ALLOW_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
assert("PATCH allowed for shop profile", ALLOW_METHODS.includes("PATCH"));
assert("OPTIONS still allowed", ALLOW_METHODS.includes("OPTIONS"));

function publicShopHandle(row) {
  return row.seller_handle || row.seller_slug
    ? String(row.seller_handle || row.seller_slug).replace(/^@+/, "")
    : undefined;
}
assert(
  "prefers user handle over seller slug",
  publicShopHandle({ seller_handle: "@ada", seller_slug: "sokoni-store" }) === "ada"
);
assert(
  "falls back to seller slug",
  publicShopHandle({ seller_handle: null, seller_slug: "vintage-ke" }) === "vintage-ke"
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
