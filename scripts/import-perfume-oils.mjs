/**
 * Import perfume-oil catalog into master products.json.
 *
 * Fixed wholesale + retail per bottle size (not 100+8% formula).
 *
 *   node scripts/import-perfume-oils.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MASTER = path.join(ROOT, "whatsapp-bot", "src", "data", "products.json");
const SCENTS_FILE = path.join(ROOT, "whatsapp-bot", "src", "data", "perfume-oils-scents.txt");

const SIZE_TIERS = [
  { key: "30ml", label: "30ml", volumeMl: 30, sourcePriceKes: 270, priceKes: 700 },
  { key: "50ml", label: "50ml", volumeMl: 50, sourcePriceKes: 450, priceKes: 950 },
  { key: "100ml", label: "100ml", volumeMl: 100, sourcePriceKes: 800, priceKes: 1250 },
  { key: "250ml", label: "250ml", volumeMl: 250, sourcePriceKes: 1750, priceKes: 2150 },
  { key: "500ml", label: "500ml", volumeMl: 500, sourcePriceKes: 3350, priceKes: 3700 },
  { key: "1l", label: "1 Litre", volumeMl: 1000, sourcePriceKes: 5450, priceKes: 5700 },
];

function slugify(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function loadScents(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildPerfumeProducts(scents) {
  const products = [];
  scents.forEach((scent, index) => {
    const scentSlug = slugify(scent) || `scent-${index + 1}`;
    const scentNum = String(index + 1).padStart(3, "0");

    for (const tier of SIZE_TIERS) {
      const id = `po-${scentNum}-${tier.key}`;
      const priceKes = tier.priceKes;
      const retailPerMl = Math.round((priceKes / tier.volumeMl) * 100) / 100;

      products.push({
        id,
        name: `${scent} — ${tier.label} Perfume Oil`,
        category: "health-beauty",
        subcategory: "perfume-oils",
        sourcePriceKes: tier.sourcePriceKes,
        priceKes,
        volumeMl: tier.volumeMl,
        retailPerMlKes: retailPerMl,
        rating: 4.6,
        reviews: 0,
        source: "Sokoni",
        emoji: "🌸",
        tags: ["perfume-oil", "fragrance", "beauty"],
        scope: "local",
        fulfillment: "store",
        payment: "cod",
        inStock: true,
        description: `Premium inspired perfume oil. ${tier.label} bottle. Pay on delivery.`,
      });
    }
  });
  return products;
}

async function main() {
  const scents = loadScents(await readFile(SCENTS_FILE, "utf-8"));
  if (scents.length === 0) {
    throw new Error("No scents found in perfume-oils-scents.txt");
  }

  const master = JSON.parse(await readFile(MASTER, "utf-8"));
  const withoutPerfumeOils = master.filter(
    (p) => p.subcategory !== "perfume-oils" && !String(p.id || "").startsWith("po-")
  );

  const perfumeProducts = buildPerfumeProducts(scents);
  const merged = [...withoutPerfumeOils, ...perfumeProducts];

  await writeFile(MASTER, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  console.log(
    `Imported ${scents.length} scents × ${SIZE_TIERS.length} sizes = ${perfumeProducts.length} perfume-oil SKUs`
  );
  console.log(`Master catalog: ${withoutPerfumeOils.length} other + ${perfumeProducts.length} oils = ${merged.length} total`);
  console.log("\nFixed wholesale → retail per size:");
  for (const tier of SIZE_TIERS) {
    console.log(
      `  ${tier.label.padEnd(6)} KES ${tier.sourcePriceKes} → KES ${tier.priceKes}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
