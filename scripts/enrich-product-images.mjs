// Auto-generates a realistic product photo for every catalog item.
//
//   node scripts/enrich-product-images.mjs          # only missing/outdated images
//   node scripts/enrich-product-images.mjs --force  # regenerate all
//
// Optional (real Google product photos, free tier at https://serper.dev):
//   SERPER_API_KEY=... node scripts/enrich-product-images.mjs
//
// After this, run: node scripts/build-site-catalog.mjs
// Or use:          node scripts/sync-catalog.mjs   (images + site catalog)

import { readFile, writeFile } from "node:fs/promises";
import {
  MASTER,
  enrichProductImage,
  fileExists,
  imageKeyForName,
  localImageFile,
  needsImage,
  sleep,
} from "./lib/product-images.mjs";

const force = process.argv.includes("--force");
const serperKey = process.env.SERPER_API_KEY || "";
const delayMs = Number(process.env.IMAGE_FETCH_DELAY_MS) || 2500;

async function main() {
  const products = JSON.parse(await readFile(MASTER, "utf-8"));
  let created = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`\nSokoni product images — ${products.length} items`);
  console.log("Sources: Serper (optional) → Wikimedia → DuckDuckGo → Openverse → AI fallback\n");

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const label = `[${i + 1}/${products.length}] ${product.id}`;

    if (!force && !needsImage(product) && (await fileExists(localImageFile(product.id)))) {
      product.imageUrl = product.imageUrl?.includes("assets/images/products")
        ? product.imageUrl
        : `assets/images/products/${product.id}.jpg`;
      if (!product.imageKey) product.imageKey = imageKeyForName(product.name);
      console.log(`${label} cached ✓`);
      skipped++;
      continue;
    }

    process.stdout.write(`${label} ${product.name.slice(0, 40)}… `);
    try {
      const result = await enrichProductImage(product, {
        serperKey,
        force,
        log: (msg) => console.log(`\n  ${msg}`),
      });
      product.imageUrl = result.path;
      product.imageKey = imageKeyForName(product.name);
      console.log(result.skipped ? "cached ✓" : `saved (${result.source}) ✓`);
      if (!result.skipped) created++;
      else skipped++;
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      failed++;
    }

    if (i < products.length - 1) await sleep(delayMs);
  }

  await writeFile(MASTER, JSON.stringify(products, null, 2) + "\n", "utf-8");
  console.log(`\nDone. created: ${created}, skipped: ${skipped}, failed: ${failed}`);
  console.log(`Updated ${MASTER}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
