// Generates the PUBLIC website catalog from the single master catalog the bot
// uses. Run this after editing products:
//
//   node scripts/build-site-catalog.mjs
//
// Master (private, you edit this one):
//   whatsapp-bot/src/data/products.json   -> has your cost (sourcePriceKes),
//                                            supplier + sourceUrl (private)
// Output (public, auto-generated, do NOT hand-edit):
//   website/data/products.json            -> customers only see YOUR price,
//                                            never your cost or supplier

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MASTER = path.join(ROOT, "whatsapp-bot", "src", "data", "products.json");
const OUTPUT = path.join(ROOT, "website", "data", "products.json");

// Retail = supplier cost + KES 100 + 8% (rounded to nearest KES 50).
function computeRetail(sourcePriceKes) {
  const cost = Math.max(0, Number(sourcePriceKes) || 0);
  const raw = cost + 100 + Math.round(cost * 0.08);
  return Math.ceil(raw / 50) * 50;
}

const SOURCE_LABELS = {
  aliexpress: "AliExpress",
  amazon: "Amazon",
  temu: "Temu",
  jumia: "Jumia",
  kilimall: "Kilimall",
};

const CATEGORY_EMOJI = {
  "phones-tablets": "📱",
  "tvs-audio": "📺",
  appliances: "🔌",
  "health-beauty": "💄",
  "home-office": "🏠",
  fashion: "👗",
  computing: "💻",
  gaming: "🎮",
  supermarket: "🛒",
  "baby-products": "🍼",
};

function toPublic(product) {
  const emoji = product.emoji || CATEGORY_EMOJI[product.category] || "🛍️";

  // Store items: pay-on-delivery. Never expose cost price or supplier.
  if (product.fulfillment === "store") {
    const priceKes =
      product.priceKes != null
        ? product.priceKes
        : computeRetail(product.sourcePriceKes || 0);
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      priceKes,
      rating: product.rating,
      reviews: product.reviews,
      source: "Sokoni",
      emoji,
      scope: "local",
      fulfillment: "store",
      payment: "cod",
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
      ...(product.subcategory ? { subcategory: product.subcategory } : {}),
    };
  }

  // International (affiliate) items shown in the "Shop International" section.
  if (product.scope === "international") {
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      priceUsd: product.priceUsd,
      rating: product.rating,
      reviews: product.reviews,
      source: SOURCE_LABELS[product.source] || product.source,
      emoji,
      scope: "international",
      estDelivery: product.estDeliveryDays
        ? `${product.estDeliveryDays}`
        : undefined,
      sourceUrl: product.sourceUrl,
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
    };
  }

  return null; // anything else is not published to the website
}

async function main() {
  const master = JSON.parse(await readFile(MASTER, "utf-8"));
  const publicItems = master.map(toPublic).filter(Boolean);
  await writeFile(OUTPUT, JSON.stringify(publicItems, null, 2) + "\n", "utf-8");

  const store = publicItems.filter((p) => p.fulfillment === "store").length;
  const intl = publicItems.filter((p) => p.scope === "international").length;
  console.log(
    `Built ${OUTPUT}\n  store (pay-on-delivery): ${store}\n  international: ${intl}\n  total: ${publicItems.length}`
  );
}

main().catch((err) => {
  console.error("Failed to build site catalog:", err);
  process.exit(1);
});
