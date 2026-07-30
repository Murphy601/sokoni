/**
 * Static checks for price-drop + counter-offer plumbing (no DB).
 * Run: node whatsapp-bot/scripts/test-price-drop-counter-static.mjs
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

const socialRepo = readFileSync(path.join(root, "src/db/repositories/social.js"), "utf8");
assert(socialRepo.includes('"countered"'), "respondToOffer accepts countered action");
assert(socialRepo.includes("wasCountered"), "counter sets wasCountered flag");
assert(socialRepo.includes("persistedStatus = \"accepted\""), "counter locks as accepted");

const notify = readFileSync(path.join(root, "src/services/social-notifications.js"), "utf8");
assert(notify.includes("notifyLikersPriceDrop"), "price-drop notifier exported");
assert(notify.includes("Seller countered"), "counter WA copy present");
assert(notify.includes("Price drop"), "price-drop WA copy present");

const onboard = readFileSync(path.join(root, "src/services/seller-onboard.js"), "utf8");
assert(onboard.includes("updateSellerListingPrice"), "seller price update service exists");
assert(onboard.includes("notifyLikersPriceDrop"), "price update calls liker notify");

const onboardApi = readFileSync(path.join(root, "src/routes/sellerOnboardApi.js"), "utf8");
assert(onboardApi.includes('"/price"'), "POST /api/seller/onboard/price route");

const socialApi = readFileSync(path.join(root, "src/routes/socialApi.js"), "utf8");
assert(socialApi.includes("countered: Boolean(result.countered)"), "respond route passes countered flag");

const inbox = readFileSync(
  path.join(root, "..", "website/assets/js/inbox.js"),
  "utf8"
);
assert(inbox.includes('data-action="countered"'), "inbox Counter button");

const sell = readFileSync(
  path.join(root, "..", "website/assets/js/seller-listing.js"),
  "utf8"
);
assert(sell.includes("dropListingPrice"), "seller drop-price UI");
assert(sell.includes('data-action="countered"'), "seller dashboard Counter button");

console.log("\nAll price-drop / counter static checks passed.");
