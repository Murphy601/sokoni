import { loadCatalogs, saveCatalogs, buildIndex, applyUpdate } from "./lib/catalog.mjs";
import { createLogger } from "./lib/log.mjs";
import * as amazon from "./providers/amazon.mjs";
import * as aliexpress from "./providers/aliexpress.mjs";
import * as structured from "./providers/structuredData.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const SCRAPE_SOURCES = new Set(["kilimall", "jumia", "temu"]);

async function main() {
  const log = createLogger();
  log.info(`\n🛒 Sokoni catalog sync ${DRY_RUN ? "(dry-run)" : ""}\n`);

  const catalogs = await loadCatalogs();
  const index = buildIndex(catalogs);
  const items = [...index.values()];

  const groups = { amazon: [], aliexpress: [], scrape: [] };
  for (const item of items) {
    if (item.source === "amazon") groups.amazon.push(item);
    else if (item.source === "aliexpress") groups.aliexpress.push(item);
    else if (SCRAPE_SOURCES.has(item.source)) groups.scrape.push(item);
  }

  log.info(
    `Catalog: ${items.length} products — ` +
      `amazon ${groups.amazon.length}, aliexpress ${groups.aliexpress.length}, ` +
      `kilimall/jumia/temu ${groups.scrape.length}\n`
  );

  // Gather updates from every provider, then merge per product id.
  const merged = new Map();
  const absorb = (map) => {
    for (const [id, update] of map) {
      merged.set(id, { ...(merged.get(id) || {}), ...update });
    }
  };
  absorb(await amazon.fetchUpdates(groups.amazon, log));
  absorb(await aliexpress.fetchUpdates(groups.aliexpress, log));
  absorb(await structured.fetchUpdates(groups.scrape, log));

  const now = new Date().toISOString();
  let changedItems = 0;
  for (const [id, update] of merged) {
    if (!update || Object.keys(update).length === 0) continue;
    const changedWebsite = applyUpdate(catalogs.website, id, update);
    const changedBot = applyUpdate(catalogs.bot, id, update);
    if (changedWebsite || changedBot) {
      applyUpdate(catalogs.website, id, { lastSyncedAt: now });
      applyUpdate(catalogs.bot, id, { lastSyncedAt: now });
      changedItems++;
      log.provider("update", `${id} → ${JSON.stringify(update)}`);
    }
  }

  log.info("");
  if (changedItems === 0) {
    log.ok("No catalog changes.");
  } else if (DRY_RUN) {
    log.ok(`${changedItems} product(s) would be updated (dry-run — nothing written).`);
  } else {
    await saveCatalogs(catalogs);
    log.ok(`Updated ${changedItems} product(s) and wrote both catalog files.`);
  }

  log.info(
    `\nSummary: changed ${changedItems}, skipped ${log.counts.skipped}, ` +
      `warnings ${log.counts.warnings}, errors ${log.counts.errors}\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
