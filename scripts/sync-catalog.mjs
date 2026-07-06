// One command after editing products.json:
//   node scripts/sync-catalog.mjs
//
// 1) Auto-fetch/generate product images for any new or renamed items
// 2) Rebuild the public website catalog

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script), ...args], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

async function main() {
  console.log("=== Step 1/2: Product images ===\n");
  await run("enrich-product-images.mjs");
  console.log("\n=== Step 2/2: Website catalog ===\n");
  await run("build-site-catalog.mjs");
  console.log("\nCatalog sync complete.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
