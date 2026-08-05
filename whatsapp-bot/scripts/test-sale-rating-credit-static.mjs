/**
 * Static checks: automatic +1 sale rating helpers are exported and wired.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const social = readFileSync(path.join(root, "src/db/repositories/social.js"), "utf8");
const hub = readFileSync(path.join(root, "src/services/communication-hub.js"), "utf8");
const mapper = readFileSync(path.join(root, "src/db/product-mapper.js"), "utf8");
const shop = readFileSync(path.join(root, "..", "website/shop.html"), "utf8");
const depopUi = readFileSync(path.join(root, "..", "website/assets/css/depop-ui.css"), "utf8");

assert.match(social, /export async function creditSellerSaleReview/);
assert.match(social, /export async function backfillSellerSaleReviews/);
assert.match(social, /Completed sale/);
assert.match(social, /backfillSellerSaleReviews/);
assert.match(hub, /creditSellerSaleReview/);
assert.match(mapper, /seller_avg_rating/);
assert.match(mapper, /seller_total_reviews/);
assert.match(shop, /#FF2300/);
assert.match(shop, /depop-red/);
assert.match(depopUi, /body\.has-depop-shell \.product-sheet-order/);
assert.match(depopUi, /--depop-action/);

console.log("ok: sale rating credit + depop shop colors wired");
