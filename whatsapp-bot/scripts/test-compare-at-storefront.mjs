/**
 * Assert storefront price HTML matrix for compare-at / % OFF.
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

function buyerPriceKes(product) {
  return Math.round(Number(product.priceKes || product.totalKes) || 0);
}

function compareAtPriceKes(product) {
  return Math.round(Number(product.compareAtPrice ?? product.originalPriceKes) || 0);
}

function isOnSale(product) {
  const compareAt = compareAtPriceKes(product);
  const price = buyerPriceKes(product);
  return Boolean(compareAt && price && price < compareAt);
}

function discountPercent(product) {
  if (!isOnSale(product)) return 0;
  const compareAt = compareAtPriceKes(product);
  const price = buyerPriceKes(product);
  return Math.max(1, Math.round(((compareAt - price) / compareAt) * 100));
}

function priceCardHtml(product) {
  const price = buyerPriceKes(product);
  const compareAt = compareAtPriceKes(product);
  const onSale = isOnSale(product);
  const pct = discountPercent(product);
  return {
    onSale,
    pct,
    html: onSale
      ? `<span class="badge-promo">${pct}% OFF</span><span class="current-price">KES ${price.toLocaleString()}</span><span class="compare-price">was KES ${compareAt.toLocaleString()}</span>`
      : `<span class="current-price">KES ${price.toLocaleString()}</span>`,
  };
}

// Matrix
{
  const normal = priceCardHtml({ priceKes: 1500 });
  assert(!normal.onSale, "normal: no sale");
  assert(!normal.html.includes("% OFF"), "normal: no badge");
  assert(!normal.html.includes("was KES"), "normal: no was");
}
{
  const drop = priceCardHtml({ priceKes: 1500, compareAtPrice: 1700 });
  assert(drop.onSale && drop.pct === 12, "drop: 12% OFF");
  assert(drop.html.includes("was KES 1,700"), "drop: was label");
  assert(drop.html.includes("KES 1,500"), "drop: now price");
  assert(drop.html.includes("12% OFF"), "drop: badge");
}
{
  const raise = priceCardHtml({ priceKes: 2000, compareAtPrice: 1700 });
  assert(!raise.onSale, "raise: badges hidden when current >= compare");
}
{
  const pctPromo = priceCardHtml({ priceKes: 1350, originalPriceKes: 1500 });
  assert(pctPromo.pct === 10, "percent promo 10% OFF");
  assert(pctPromo.html.includes("was KES 1,500"), "percent was label");
}

// API publicPromoFields agree
{
  const f = publicPromoFields({
    priceKes: 1500,
    originalPriceKes: 1700,
    freeShipping: true,
    shippingKes: 0,
  });
  assert(f.compareAtPrice === 1700 && f.discountPct === 12, "API fields for drop");
}
{
  const f = publicPromoFields({
    priceKes: 2000,
    originalPriceKes: 1700,
    freeShipping: true,
    shippingKes: 0,
  });
  assert(Object.keys(f).length === 0, "API hides raise");
}

const app = readFileSync(path.join(root, "website/assets/js/app.js"), "utf8");
assert(app.includes("was KES"), "storefront shows was KES");
assert(app.includes("badge-promo"), "badge-promo class");
assert(app.includes("compare-price"), "compare-price class");
assert(app.includes("current < original"), "strict compare rule");

const build = readFileSync(path.join(root, "scripts/build-site-catalog.mjs"), "utf8");
assert(build.includes("compareAtPrice"), "site catalog emits compareAtPrice");

const css = readFileSync(path.join(root, "website/assets/css/depop-ui.css"), "utf8");
assert(css.includes(".compare-price"), "CSS compare-price");
assert(css.includes("text-decoration: line-through"), "CSS strike-through");

console.log("compare-at storefront matrix OK");
