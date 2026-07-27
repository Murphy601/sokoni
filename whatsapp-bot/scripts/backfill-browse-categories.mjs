#!/usr/bin/env node
/** Backfill products.browse_category / browse_sub_category from legacy category map. */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { query, closePool, isDbEnabled } from "../src/db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const taxonomyUrl = pathToFileURL(
  path.join(__dirname, "..", "..", "scripts", "browse-taxonomy.mjs")
).href;
const { mapLegacyToBrowse } = await import(taxonomyUrl);

async function main() {
  if (!isDbEnabled()) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const { rows } = await query(`
    SELECT id, category, sub_category, browse_category, browse_sub_category
    FROM products
  `);

  let updated = 0;
  for (const row of rows) {
    const mapped = mapLegacyToBrowse(row.category, row.sub_category);
    if (
      row.browse_category === mapped.browse &&
      row.browse_sub_category === mapped.sub
    ) {
      continue;
    }
    await query(
      `UPDATE products SET browse_category = $1, browse_sub_category = $2, updated_at = NOW() WHERE id = $3`,
      [mapped.browse, mapped.sub, row.id]
    );
    updated += 1;
  }

  console.log(`[browse-backfill] ${updated} of ${rows.length} products updated`);
}

main()
  .catch((err) => {
    console.error("[browse-backfill] failed:", err.message);
    process.exit(1);
  })
  .finally(() => closePool());
