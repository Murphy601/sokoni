/**
 * One-shot: upsert master products.json into Postgres so homepage + /shop
 * match Seller Hub (fixes wrong sokoni-store ownership / sticky sold).
 *
 * On the bot VM:
 *   cd ~/sokoni/whatsapp-bot && node scripts/resync-catalog-db.mjs
 */
import { syncMasterCatalogToDb } from "../src/db/repositories/products.js";
import { isDbEnabled, pingDb } from "../src/db/pool.js";

if (!isDbEnabled()) {
  console.error("DATABASE_URL not set — nothing to sync.");
  process.exit(1);
}

const ping = await pingDb();
if (!ping.ok) {
  console.error("Postgres not reachable:", ping.reason || "unknown");
  process.exit(1);
}

const result = await syncMasterCatalogToDb();
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      upserted: result.upserted,
      total: result.total,
      errors: result.errors?.slice(0, 10) || [],
    },
    null,
    2
  )
);
process.exit(result.ok ? 0 : 2);
