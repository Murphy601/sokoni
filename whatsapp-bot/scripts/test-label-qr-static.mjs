/**
 * Static checks for prepaid drop-off label QR + Depop chrome.
 * Run: node whatsapp-bot/scripts/test-label-qr-static.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
}

const vendor = path.join(root, "website/assets/vendor/qrcode.min.js");
assert(existsSync(vendor), "vendored qrcode.min.js exists");

const code = readFileSync(vendor, "utf8");
const sandbox = { window: {}, self: {}, globalThis: {} };
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
assert(typeof sandbox.QRCode?.toCanvas === "function", "QRCode.toCanvas available on window");

const html = readFileSync(path.join(root, "website/label.html"), "utf8");
assert(html.includes('src="assets/vendor/qrcode.min.js"'), "label.html loads local QR vendor");
assert(!html.includes("cdn.jsdelivr.net/npm/qrcode"), "broken jsDelivr QR CDN removed");
assert(html.includes("label-depop-page") || html.includes("depop-surface-page"), "label page uses Depop surface");
assert(html.includes("label-route"), "label shows ship-to route block");

const js = readFileSync(path.join(root, "website/assets/js/label.js"), "utf8");
assert(js.includes("resolveQrLib"), "label.js resolves QR library safely");
assert(js.includes("errorCorrectionLevel"), "QR render options set");

const css = readFileSync(path.join(root, "website/assets/css/label.css"), "utf8");
assert(css.includes("#ff2300") || css.includes("#FF2300"), "label CSS uses Depop scarlet accent");

console.log("\nAll label QR / Depop static checks passed.");
