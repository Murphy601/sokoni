#!/usr/bin/env node
/**
 * Direct WAHA dispute-alert smoke test (not Baileys).
 *
 * On the VM:
 *   cd ~/sokoni/whatsapp-bot
 *   node scripts/test-waha-dispute-alert.mjs 2547XXXXXXXX
 *
 * Pass a REAL Kenya phone (2547…), not the placeholder string.
 * Uses the same sendTextReliable path as dispute alerts (not normal chat sendText).
 * Exit 0 = WAHA accepted the send; exit 1 = failed / dry-run.
 */
import { config } from "../src/config.js";
import { sendTextReliable, toChatId } from "../src/services/whatsapp.js";

const phone = process.argv[2] || config.admin.primary || "";
if (!phone) {
  console.error("Usage: node scripts/test-waha-dispute-alert.mjs <2547XXXXXXXX>");
  console.error("Also set ADMIN_PHONES or pass a real phone argument.");
  process.exit(1);
}

const digits = String(phone).replace(/\D/g, "");
if (/x/i.test(String(phone)) || digits.length < 10 || digits === "2547") {
  console.error(
    "FAIL: pass a real phone like 254712345678 — not the placeholder 2547XXXXXXXX"
  );
  console.error("Got:", phone, "→ chatId would be", toChatId(phone) || "(empty)");
  process.exit(1);
}

console.log("WAHA_API_URL:", config.waha.apiUrl || "(UNSET — dry-run, will NOT deliver)");
console.log("WAHA session:", config.waha.session);
console.log("Target:", toChatId(phone));

const msg =
  `🚨 *TEST DISPUTE ALERT*\n\n` +
  `Sokoni VM WAHA smoke test at ${new Date().toISOString()}.\n` +
  `If you received this, dispute seller/admin sends can reach this number.`;

try {
  const result = await sendTextReliable(phone, msg, { label: "test-waha-dispute-alert" });
  if (result?.dryRun || !result?.ok) {
    console.error("FAIL: message not delivered", result);
    process.exit(1);
  }
  console.log("OK: WAHA accepted send →", result.chatId);
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err.message);
  process.exit(1);
}
