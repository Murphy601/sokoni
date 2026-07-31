#!/usr/bin/env node
/**
 * Backfill products.browse_category / browse_sub_category from legacy category map.
 * Also migrates stale browse paths (women/beauty → health-beauty, home/supermarket → supermarket).
 */
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

/** Prior browse paths retired by the Kilimall-gap remap. */
const STALE_BROWSE_MIGRATIONS = [
  {
    from: { browse: "women", sub: "beauty" },
    to: { browse: "health-beauty", sub: "personal-care" },
  },
  {
    from: { browse: "home", sub: "supermarket" },
    to: { browse: "supermarket", sub: "food-staples" },
  },
];

function applyStaleBrowseMigration(browse, sub) {
  for (const rule of STALE_BROWSE_MIGRATIONS) {
    if (browse === rule.from.browse && sub === rule.from.sub) {
      return { browse: rule.to.browse, sub: rule.to.sub };
    }
  }
  return null;
}

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
  let staleMigrated = 0;
  for (const row of rows) {
    let mapped = mapLegacyToBrowse(row.category, row.sub_category);
    const stale = applyStaleBrowseMigration(row.browse_category, row.browse_sub_category);

    if (stale) {
      if (mapped.browse === "health-beauty" || mapped.browse === "supermarket") {
        // Legacy map already placed them on the new top-level (keep specific sub).
      } else {
        mapped = stale;
        staleMigrated += 1;
      }
    }

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

  console.log(
    `[browse-backfill] ${updated} of ${rows.length} products updated` +
      (staleMigrated ? ` (${staleMigrated} via stale browse migration)` : "")
  );
}

main()
  .catch((err) => {
    console.error("[browse-backfill] failed:", err.message);
    process.exit(1);
  })
  .finally(() => closePool());
