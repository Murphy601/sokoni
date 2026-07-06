#!/usr/bin/env node
/** Run once: node scripts/tiktok-post.mjs — or schedule 3× daily via cron / TIKTOK_CRON_ENABLED */
import { runTiktokPostJob } from "../whatsapp-bot/src/services/tiktok.js";

try {
  const entry = await runTiktokPostJob();
  console.log("OK:", entry.productId, entry.dryRun ? "(dry-run)" : entry.tiktokPublishId);
} catch (err) {
  console.error("TikTok post failed:", err.message);
  process.exit(1);
}
