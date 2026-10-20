/**
 * Static checks for seller review matching + auto sale ratings.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const social = readFileSync(path.join(root, "src/db/repositories/social.js"), "utf8");
const orders = readFileSync(path.join(root, "src/services/orders.js"), "utf8");
const escrow = readFileSync(path.join(root, "src/services/escrow-automation.js"), "utf8");
const hub = readFileSync(path.join(root, "src/services/communication-hub.js"), "utf8");

assert.match(social, /async function jsonOrderBelongsToSeller/);
assert.match(social, /export async function ensureOrderSellerUserId/);
assert.match(social, /async function loadShopReviewStats/);
assert.match(social, /LOWER\(handle\) = \$1 OR LOWER\(handle\) = \$2/);
assert.match(social, /jsonOrderBelongsToSeller\(order\.jsonOrder, sellerId\)/);
assert.match(social, /jsonOrderBelongsToSeller\(order, sellerId\)/);
assert.match(social, /creditSellerSaleReview\(order, \{ sellerUserId: uid \}\)/);
assert.match(social, /loadShopReviewStats\(\{/);
assert.equal(
  (social.match(/loadShopReviewStats\(/g) || []).length >= 3,
  true,
  "shop profile paths + helper must call loadShopReviewStats"
);
assert.match(orders, /sellerUserId:/);
assert.match(escrow, /ensureOrderSellerUserId/);
assert.match(hub, /ensureOrderSellerUserId/);
assert.match(social, /isJsonOrderDelivered/);

console.log("ok: review seller match + auto rating wiring");
