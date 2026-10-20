/**
 * Seller analytics helpers smoke test.
 * Run: node website/scripts/test-seller-analytics.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const code = readFileSync(path.join(__dirname, "../assets/js/seller-analytics.js"), "utf-8");

const sandbox = {
  console,
  document: { getElementById: () => null },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInContext(code, vm.createContext(sandbox));

const api = sandbox.SokoniSellerAnalytics;
const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

const week = 7 * 24 * 60 * 60 * 1000;
const now = Date.now();
const orders = [
  { paid: true, createdAt: now - week * 0.2, sellerNetKes: 1500, quantity: 1, productId: "a", productName: "Avocado bag" },
  { paid: true, createdAt: now - week * 0.3, sellerNetKes: 1500, quantity: 1, productId: "a", productName: "Avocado bag" },
  { paid: true, createdAt: now - week * 1.2, sellerNetKes: 1200, quantity: 2, productId: "b", productName: "Kiondo" },
  { paid: false, createdAt: now, sellerNetKes: 9999, quantity: 1, productId: "c", productName: "Unpaid" },
];

const { buckets, paidCount } = api.buildSalesVsPriceSeries(orders, 6);
assert(paidCount === 3, "counts paid orders only");
assert(buckets.length === 6, "six week buckets");
const thisWeek = buckets[buckets.length - 1];
assert(thisWeek.unitsSold === 2, "this week units from two avocado sales");
assert(thisWeek.avgPrice === 1500, "avg price this week");
const prev = buckets[buckets.length - 2];
assert(prev.unitsSold === 2, "prior week units (qty 2)");
assert(prev.avgPrice === 600, "avg price = revenue/units for multi-qty");

const tops = api.topProductsByRevenue(orders, 3);
assert(tops[0].productName === "Avocado bag", "top earner avocado");
assert(tops[0].revenueKes === 3000, "avocado revenue");

const segs = api.buildEscrowSegments({
  available: { totalKes: 10000 },
  pendingEscrow: { totalKes: 5000 },
  inTransit: { totalKes: 2000 },
  paidOut: { totalKes: 40000 },
});
assert(segs.length === 4, "four escrow segments");
assert(segs.find((s) => s.key === "paidOut").value === 40000, "paid out segment");

if (failures.length) {
  console.error("FAIL:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("OK: seller analytics series + escrow segments + top products.");
