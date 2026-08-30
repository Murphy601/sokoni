#!/usr/bin/env node
/**
 * Direct WAHA sendText smoke test (dispute-alert path).
 *
 * Prefer no phone arg — uses ADMIN_PHONES / ADMIN_WHATSAPP_NUMBER / BUSINESS from .env:
 *   cd ~/sokoni/whatsapp-bot
 *   node scripts/test-waha-dispute-alert.mjs
 *
 * Or pass YOUR real digits only (12 digits like 2547…):
 *   node scripts/test-waha-dispute-alert.mjs 254712345678
 *
 * Never pass 2547XXXXXXXX or 2547YOURREALNUMBER.
 */
import { config } from "../src/config.js";
import { sendTextReliable, toChatId } from "../src/services/whatsapp.js";

const phone = process.argv[2] || config.admin.primary || "";
if (!phone) {
  console.error("Usage: node scripts/test-waha-dispute-alert.mjs");
  console.error("  (uses ADMIN_PHONES from .env)  OR pass 254712345678");
  process.exit(1);
}

const fromArgv = Boolean(process.argv[2]);
const raw = String(phone).trim();
const digits = raw.replace(/\D/g, "");
const looksLikePlaceholder =
  fromArgv &&
  (/x{2,}|your|real|number|placeholder|example|xxxx/i.test(raw) ||
    digits.length < 11 ||
    digits.length > 15 ||
    digits === "2547" ||
    /^2547+$/.test(digits));

if (looksLikePlaceholder) {
  console.error("FAIL: that is not a real phone number.");
  console.error("  Got:", raw);
  console.error("  Digits:", digits || "(none)", "→ would become", toChatId(raw) || "(empty)");
  console.error("  Fix: run with NO args (uses .env ADMIN_PHONES), or pass real 2547… digits:");
  console.error("    node scripts/test-waha-dispute-alert.mjs");
  console.error("    node scripts/test-waha-dispute-alert.mjs 254712345678");
  process.exit(1);
}

if (digits.length < 11) {
  console.error("FAIL: admin/business phone in .env is too short:", digits || "(empty)");
  console.error("Set ADMIN_PHONES=2547… in whatsapp-bot/.env then: pm2 restart sokoni-bot --update-env");
  process.exit(1);
}

const chatId = toChatId(phone);
const redacted = digits.length >= 6 ? `${digits.slice(0, 4)}…${digits.slice(-2)}` : digits;
console.log("WAHA_API_URL:", config.waha.apiUrl || "(UNSET — dry-run, will NOT deliver)");
console.log("WAHA session:", config.waha.session);
console.log("API key:", config.waha.apiKey ? `set (${config.waha.apiKey.length} chars)` : "MISSING");
console.log("Target:", chatId, fromArgv ? "(from argv)" : `(from .env admin/business → ${redacted})`);

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
  console.error("Next: node scripts/test-waha-ping.mjs");
  console.error("If ping fails or send times out: docker restart 93f51c97b10d");
  process.exit(1);
}
