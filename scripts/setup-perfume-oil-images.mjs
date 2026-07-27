/**
 * Download realistic perfume-oil bottle photos (one per size tier).
 * All scents share these — name is shown on the card.
 *
 *   node scripts/setup-perfume-oil-images.mjs
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { downloadToFile, IMAGES_DIR } from "./lib/product-images.mjs";

const TIERS = [
  {
    file: "po-bottle-30ml.jpg",
    seed: 301,
    prompt:
      "Professional e-commerce product photo of a small 30ml amber glass perfume oil bottle with glass dropper cap, golden liquid inside, single bottle centered, pure white background, studio lighting, photorealistic, no text no label",
  },
  {
    file: "po-bottle-50ml.jpg",
    seed: 501,
    prompt:
      "Professional e-commerce product photo of a 50ml amber glass perfume oil bottle with dropper cap, golden oil, single bottle centered, white background, studio product photography, photorealistic, no text",
  },
  {
    file: "po-bottle-100ml.jpg",
    seed: 1001,
    prompt:
      "Professional e-commerce product photo of a 100ml amber glass perfume oil bottle with dropper, golden fragrance oil, white background, studio lighting, photorealistic product shot, no text no branding",
  },
  {
    file: "po-bottle-250ml.jpg",
    seed: 2501,
    prompt:
      "Professional e-commerce product photo of a medium 250ml amber glass perfume oil bottle with pump or dropper, golden oil, white background, studio product photography, photorealistic, no text",
  },
  {
    file: "po-bottle-500ml.jpg",
    seed: 5001,
    prompt:
      "Professional e-commerce product photo of a large 500ml amber glass perfume oil bottle, golden liquid, white background, studio e-commerce photography, photorealistic, no text",
  },
  {
    file: "po-bottle-1l.jpg",
    seed: 10001,
    prompt:
      "Professional e-commerce product photo of a 1 litre large amber glass perfume oil bottle with handle, golden fragrance oil, white background, studio product photography, photorealistic, no text",
  },
];

function pollinationsUrl(prompt, seed) {
  return (
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=512&height=512&seed=${seed}&nologo=true&enhance=true`
  );
}

async function main() {
  await mkdir(IMAGES_DIR, { recursive: true });
  for (const tier of TIERS) {
    const dest = path.join(IMAGES_DIR, tier.file);
    process.stdout.write(`${tier.file}… `);
    try {
      const bytes = await downloadToFile(pollinationsUrl(tier.prompt, tier.seed), dest);
      console.log(`OK (${bytes} bytes)`);
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
    }
  }
  console.log("\nDone. Re-run: node scripts/import-perfume-oils.mjs && node scripts/build-site-catalog.mjs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
