#!/usr/bin/env node
/** Writes website/data/browse-menu.json from scripts/browse-taxonomy.mjs */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrowseMenuPayload } from "./browse-taxonomy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "website", "data", "browse-menu.json");

const payload = buildBrowseMenuPayload();
await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf-8");
console.log(`Wrote ${OUT} (${payload.categories.length} browse categories)`);
