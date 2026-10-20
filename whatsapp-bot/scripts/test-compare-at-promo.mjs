/**
 * Static checks for compare-at / promo badge rules + seller hub promo open helpers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { publicPromoFields } from "../src/lib/public-promo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// publicPromoFields matrix
assert(Object.keys(publicPromoFields({ priceKes: 1500, freeShipping: true, shippingKes: 0 })).length === 0, "normal: no badges");
{
  const f = publicPromoFields({
    priceKes: 1500,
    originalPriceKes: 1700,
    freeShipping: true,
    shippingKes: 0,
  });
  assert(f.onPromo === true, "drop: onPromo");
  assert(f.compareAtPrice === 1700, "drop: compareAt");
  assert(f.discountPct === 12, "drop: ~12% OFF");
}
assert(
  Object.keys(
    publicPromoFields({
      priceKes: 2000,
      originalPriceKes: 1700,
      freeShipping: true,
      shippingKes: 0,
    })
  ).length === 0,
  "raise with stale compare: hide badges"
);
{
  const f = publicPromoFields({
    priceKes: 1350,
    originalPriceKes: 1500,
    promo: { active: true, type: "percent", value: 10, listPriceKes: 1500 },
    freeShipping: true,
    shippingKes: 0,
  });
  assert(f.discountPct === 10, "percent promo 10% OFF");
}

const onboard = readFileSync(path.join(root, "whatsapp-bot/src/services/seller-onboard.js"), "utf8");
assert(onboard.includes("applyCompareAtOnBuyerPriceChange"), "price update sets compare-at");
assert(onboard.includes("compare_at_price"), "DB sync writes compare_at_price");
assert(onboard.includes("compareAtPrice: promo.listPriceKes"), "promo sets compareAtPrice");

const hub = readFileSync(path.join(root, "website/assets/js/seller-listing.js"), "utf8");
assert(hub.includes("openItemPromoPanel"), "promo panel opener exists");
assert(hub.includes("sokoni-listing-editor-modal"), "fixed promo modal on body");
assert(hub.includes("bindListingActionClicks"), "delegated listing action clicks");
assert(hub.includes("skipDataReload"), "opening promo does not thrash-reload hub");
assert(!/window\.prompt\(hint/.test(hub), "price drop no longer uses window.prompt");

const app = readFileSync(path.join(root, "website/assets/js/app.js"), "utf8");
assert(app.includes("compareAtPriceKes"), "storefront compare-at helper");
assert(app.includes("% OFF"), "badge copy uses % OFF");
assert(app.includes("current < original"), "strict current < compare-at");

const migration = readFileSync(
  path.join(root, "whatsapp-bot/db/schema-phase17-compare-at-price.sql"),
  "utf8"
);
assert(migration.includes("ADD COLUMN IF NOT EXISTS compare_at_price"), "migration adds column");

console.log("compare-at / promo checks OK");
