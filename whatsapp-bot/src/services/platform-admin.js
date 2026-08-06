/**
 * Phase 9 — WhatsApp admin ops commands (#ops, #sync, #catalog, #stock, #flags).
 */
import { sendText } from "./whatsapp.js";
import {
  getOpsStatus,
  pauseCatalog,
  unpauseCatalog,
  syncPublicCatalog,
  publishCatalogToGit,
  setProductStock,
  markProductSoldAndSync,
  runDbMigrate,
  runDbSeed,
  updatePlatformFlags,
} from "./catalog-ops.js";

function formatOpsStatus(s) {
  const cat = s.catalog;
  return (
    `🛠️ *Platform ops*\n\n` +
    `📦 Catalog: ${cat.paused ? "⏸ PAUSED" : "✅ LIVE"}\n` +
    `   Master: ${cat.masterCount} · Public: ${cat.publicCount}\n` +
    `${cat.reason ? `   _${cat.reason}_\n` : ""}` +
    `💳 Prepaid only: ${s.prepaidOnly ? "yes" : "no"}\n` +
    `🗄️ Postgres: ${s.database.enabled ? (s.database.connected ? "connected" : "error") : "off (JSON)"}\n` +
    `🔧 Maintenance: ${s.maintenanceMode ? "on" : "off"}`
  );
}

export async function handleOpsCommand(adminChatId) {
  const status = await getOpsStatus();
  return sendText(
    adminChatId,
    `${formatOpsStatus(status)}\n\n` +
      `#catalog live · #catalog pause\n` +
      `#sync — rebuild public catalog\n` +
      `#sync push — build + git push\n` +
      `#stock <id> in|out\n` +
      `#flags prepaid on|off`
  );
}

export async function handleSyncCommand(adminChatId, args) {
  const push = /\bpush\b/i.test(args);
  try {
    if (push) {
      await publishCatalogToGit();
      return sendText(adminChatId, "✅ Catalog published (build + git push). Cloudflare deploys in ~1–2 min.");
    }
    await syncPublicCatalog();
    const s = await getOpsStatus();
    return sendText(
      adminChatId,
      `✅ Public catalog synced.\nMaster: ${s.catalog.masterCount} → public: ${s.catalog.publicCount}`
    );
  } catch (err) {
    return sendText(adminChatId, `⚠️ Sync failed: ${err.message}`);
  }
}

export async function handleCatalogCommand(adminChatId, args) {
  const tail = String(args || "").trim().toLowerCase();
  try {
    if (tail === "live" || tail === "unpause" || tail === "on") {
      const s = await unpauseCatalog("Live via admin #catalog");
      return sendText(adminChatId, `✅ Catalog is *LIVE*.\nPublic items: ${s.catalog.publicCount}\n\nRun *#sync* if counts look wrong.`);
    }
    if (tail === "pause" || tail === "off") {
      await pauseCatalog("Paused via admin #catalog");
      return sendText(adminChatId, "⏸ Catalog *paused* — storefront shows empty state.");
    }
    if (tail === "status" || !tail) {
      const s = await getOpsStatus();
      return sendText(adminChatId, formatOpsStatus(s));
    }
    return sendText(adminChatId, "Usage: #catalog live | pause | status");
  } catch (err) {
    return sendText(adminChatId, `⚠️ #catalog failed: ${err.message}`);
  }
}

export async function handleStockCommand(adminChatId, args) {
  const parts = String(args || "").trim().split(/\s+/);
  const productId = parts[0];
  const action = (parts[1] || "").toLowerCase();
  if (!productId) {
    return sendText(adminChatId, "Usage: #stock prod_abc123 in\nOr: #stock prod_abc123 out");
  }
  const markSold = /^(sold)$/i.test(action);
  const inStock = !/^(out|off|0|false|sold)$/i.test(action);

  if (markSold) {
    const result = await markProductSoldAndSync(productId);
    if (result.error) {
      return sendText(adminChatId, `⚠️ Mark sold failed: ${result.error} (${productId})`);
    }
    return sendText(
      adminChatId,
      `✅ *${productId}* marked *sold* (tombstoned — will not reappear on publish).\nPublic catalog synced.`
    );
  }

  const result = await setProductStock(productId, inStock);
  if (result.error) {
    const detail = result.message ? ` — ${result.message}` : "";
    return sendText(adminChatId, `⚠️ Stock update failed: ${result.error}${detail} (${productId})`);
  }
  return sendText(
    adminChatId,
    `✅ *${productId}* → ${inStock ? "in stock" : "out of stock"}\nRun *#sync* to refresh the website.`
  );
}

export async function handleFlagsCommand(adminChatId, args) {
  const tail = String(args || "").trim().toLowerCase();
  if (!tail) {
    const s = await getOpsStatus();
    return sendText(
      adminChatId,
      `🏁 *Flags*\nPrepaid only: ${s.prepaidOnly}\nMaintenance: ${s.maintenanceMode}\n\n#flags prepaid on|off`
    );
  }
  if (/prepaid\s+(on|true|yes)/i.test(tail)) {
    updatePlatformFlags({ prepaidOnly: true });
    return sendText(adminChatId, "✅ Flag: prepaidOnly = true");
  }
  if (/prepaid\s+(off|false|no)/i.test(tail)) {
    updatePlatformFlags({ prepaidOnly: false });
    return sendText(adminChatId, "✅ Flag: prepaidOnly = false (legacy COD paths may apply)");
  }
  return sendText(adminChatId, "Usage: #flags prepaid on|off");
}

export async function handleDbOpsCommand(adminChatId, args) {
  const tail = String(args || "").trim().toLowerCase();
  try {
    if (tail === "migrate") {
      await runDbMigrate();
      return sendText(adminChatId, "✅ DB schema migrated.");
    }
    if (tail === "seed") {
      await runDbSeed(false);
      return sendText(adminChatId, "✅ Catalog seeded to Postgres.");
    }
    if (tail === "seed-dry") {
      await runDbSeed(true);
      return sendText(adminChatId, "✅ Dry-run seed OK.");
    }
    return sendText(adminChatId, "Usage: #db migrate | seed | seed-dry");
  } catch (err) {
    return sendText(adminChatId, `⚠️ DB ops failed: ${err.message}`);
  }
}
