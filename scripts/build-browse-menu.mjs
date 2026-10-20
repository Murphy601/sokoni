#!/usr/bin/env node
/** Writes website/data/browse-menu.json from scripts/browse-taxonomy.mjs */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrowseMenuPayload } from "./browse-taxonomy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "website", "data", "browse-menu.json");

if (process.env.SKIP_IMAGE_VERIFY !== "1") {
  const { spawnSync } = await import("node:child_process");
  const check = spawnSync(process.execPath, [path.join(__dirname, "verify-browse-images.mjs")], {
    stdio: "inherit",
  });
  if (check.status !== 0) {
    console.error("Image verify failed — fix browse-category-images.mjs before rebuilding.");
    process.exit(check.status || 1);
  }
}

const payload = buildBrowseMenuPayload();
await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf-8");
console.log(`Wrote ${OUT} (v${payload.version}, ${payload.categories.length} browse categories)`);
