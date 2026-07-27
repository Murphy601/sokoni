#!/usr/bin/env node
/**
 * Phase 9 go-live helper — unpause catalog, sync public JSON, optional DB seed.
 *
 *   node whatsapp-bot/scripts/phase9-go-live.mjs
 *   node whatsapp-bot/scripts/phase9-go-live.mjs --dry-run   # DB seed dry-run only
 *   node whatsapp-bot/scripts/phase9-go-live.mjs --skip-db   # catalog only
 */
import {
  getOpsStatus,
  unpauseCatalog,
  syncPublicCatalog,
  runDbMigrate,
  runDbSeed,
} from "../src/services/catalog-ops.js";
import { updatePlatformFlags } from "../src/services/platform-flags.js";

const dryRun = process.argv.includes("--dry-run");
const skipDb = process.argv.includes("--skip-db");

async function main() {
  console.log("=== Phase 9 go-live ===\n");

  updatePlatformFlags({ prepaidOnly: true, maintenanceMode: false });
  console.log("✓ Flags: prepaidOnly=true, maintenanceMode=false");

  await unpauseCatalog("Go-live via phase9-go-live.mjs");
  console.log("✓ Catalog unpaused");

  await syncPublicCatalog();
  console.log("✓ Public catalog synced from master");

  if (!skipDb) {
    const mig = await runDbMigrate();
    if (mig.error) {
      console.warn("⚠ DB migrate skipped:", mig.error);
    } else {
      console.log("✓ DB schema migrated");
      const seed = await runDbSeed(dryRun);
      console.log(dryRun ? "✓ DB seed dry-run OK" : "✓ DB seeded from master catalog", seed);
    }
  }

  const status = await getOpsStatus();
  console.log("\n=== Status ===");
  console.log(JSON.stringify(status, null, 2));
  console.log("\nNext: run #sync push on VM to publish website catalog to GitHub (if needed).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
