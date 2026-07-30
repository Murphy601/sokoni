/**
 * Static checks: accepted-offer reminders ping buyers on WhatsApp.
 * Run: node whatsapp-bot/scripts/test-offer-reminder-wa-static.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
}

const notify = readFileSync(path.join(root, "src/services/social-notifications.js"), "utf8");
assert(notify.includes("export async function notifyBuyerOfferReminder"), "notifyBuyerOfferReminder exported");
assert(notify.includes("Offer reminder — Sokoni"), "reminder WA copy present");
assert(notify.includes("checkout.html?offerId="), "reminder includes checkout deep link");

const api = readFileSync(path.join(root, "src/routes/socialApi.js"), "utf8");
assert(api.includes("notifyBuyerOfferReminder"), "remind route imports notifyBuyerOfferReminder");
assert(api.includes("void notifyBuyerOfferReminder({ reminder: result.reminder })"), "remind route fires WA ping");

const social = readFileSync(path.join(root, "src/db/repositories/social.js"), "utf8");
assert(social.includes("productTitle: offer.product_title"), "reminder payload includes productTitle");
assert(social.includes("amountKsh: offer.amount_kes"), "reminder payload includes amountKsh");

console.log("\nAll offer-reminder WhatsApp static checks passed.");
