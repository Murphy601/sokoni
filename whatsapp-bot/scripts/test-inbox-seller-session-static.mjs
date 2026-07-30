/**
 * Static checks: seller inbox session survives cross-tab opens.
 * Run: node whatsapp-bot/scripts/test-inbox-seller-session-static.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
}

const sell = readFileSync(path.join(root, "website/assets/js/seller-listing.js"), "utf8");
assert(sell.includes("localStorage.setItem(VERIFY_TOKEN_KEY"), "seller token saved to localStorage");
assert(sell.includes("localStorage.getItem(VERIFY_TOKEN_KEY)"), "seller token loaded from localStorage");
assert(sell.includes('params.set("sessionToken", sessionToken)'), "inbox offer link includes sessionToken");
assert(sell.includes("window.location.href = url"), "open chat prefers same-tab navigation");

const inbox = readFileSync(path.join(root, "website/assets/js/inbox.js"), "utf8");
assert(inbox.includes("localStorage.getItem(SELLER_VERIFY_TOKEN_KEY)"), "inbox reads seller token from localStorage");
assert(inbox.includes("readSellerSessionFromQuery"), "inbox accepts deep-link seller session");
assert(inbox.includes("persistSellerSession"), "inbox persists seller session across stores");
assert(inbox.includes("params.delete(\"sessionToken\")"), "inbox strips token from URL after hydrate");

console.log("\nAll inbox seller-session static checks passed.");
