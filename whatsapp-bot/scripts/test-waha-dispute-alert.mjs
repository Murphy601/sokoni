#!/usr/bin/env node
/**
 * Direct WAHA dispute-alert smoke test (not Baileys).
 *
 * Deploy first from repo root (NOT from whatsapp-bot/):
 *   cd ~/sokoni
 *   SKIP_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh
 *
 * Then smoke-test with a REAL phone (your WhatsApp number digits):
 *   cd ~/sokoni/whatsapp-bot
 *   node scripts/test-waha-dispute-alert.mjs 254712345678
 *
 * Do NOT paste placeholders like 2547XXXXXXXX or 2547YOURREALNUMBER.
 * Uses sendTextReliable (dispute alerts only) — not normal chat sendText.
 */
import { config } from "../src/config.js";
import { sendTextReliable, toChatId } from "../src/services/whatsapp.js";

const phone = process.argv[2] || config.admin.primary || "";
if (!phone) {
  console.error("Usage: node scripts/test-waha-dispute-alert.mjs 254712345678");
  console.error("Pass your real Kenya WhatsApp number (2547…), or set ADMIN_PHONES.");
  process.exit(1);
}

const raw = String(phone).trim();
const digits = raw.replace(/\D/g, "");
const looksLikePlaceholder =
  /x{2,}|your|real|number|placeholder|example|xxxx/i.test(raw) ||
  digits.length < 11 ||
  digits.length > 15 ||
  digits === "2547" ||
  /^2547+$/.test(digits);

if (looksLikePlaceholder) {
  console.error("FAIL: that is not a real phone number.");
  console.error("  Got:", raw);
  console.error("  Digits:", digits || "(none)", "→ would become", toChatId(raw) || "(empty)");
  console.error("  Example: node scripts/test-waha-dispute-alert.mjs 254712345678");
  console.error("  Tip: use YOUR WhatsApp number in international form (254…), no spaces.");
  process.exit(1);
}

const chatId = toChatId(phone);
console.log("WAHA_API_URL:", config.waha.apiUrl || "(UNSET — dry-run, will NOT deliver)");
console.log("WAHA session:", config.waha.session);
console.log("Target:", chatId);

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
  console.error("If this is a timeout, WAHA may be hung — run: node scripts/test-waha-ping.mjs");
  process.exit(1);
}
