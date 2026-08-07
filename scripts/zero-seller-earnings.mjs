#!/usr/bin/env node
/**
 * Zero ONE seller's earnings ledger (settlements + withdrawals) safely.
 *
 * Does NOT delete products, shop profile, or other sellers.
 * Latches released orders as isPaidOut so healReleasedSellerPayouts cannot
 * recreate Ready-for-M-Pesa balances.
 *
 * Usage (on bot VM):
 *   node scripts/zero-seller-earnings.mjs --seller adiv_thrift          # dry-run
 *   node scripts/zero-seller-earnings.mjs --seller adiv_thrift --apply  # write
 *
 * Optional:
 *   --also-clear-pending-escrow  clear held-escrow display fields on that
 *                                seller's non-cancelled orders (test reset only)
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DATA = process.env.SOKONI_DATA_DIR || path.join(REPO, "whatsapp-bot", "data");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const clearPending = args.includes("--also-clear-pending-escrow");
const sellerArgIdx = args.indexOf("--seller");
const sellerQuery = sellerArgIdx >= 0 ? String(args[sellerArgIdx + 1] || "").trim() : "adiv_thrift";

if (!sellerQuery) {
  console.error("Usage: node scripts/zero-seller-earnings.mjs --seller adiv_thrift [--apply]");
  process.exit(1);
}

function loadJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf-8"));
}

function backup(file) {
  if (!existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.bak-zero-earnings-${stamp}`;
  copyFileSync(file, dest);
  return dest;
}

function matchSeller(s, q) {
  const needle = q.toLowerCase().replace(/^@/, "").replace(/\s+/g, "_");
  const id = String(s.id || "").toLowerCase();
  const handle = String(s.shopHandle || s.handle || "").toLowerCase().replace(/^@/, "");
  const name = String(s.businessName || s.shopName || "").toLowerCase();
  const nameKey = name.replace(/[^a-z0-9]+/g, "_");
  return (
    id === needle ||
    id.includes(needle) ||
    handle === needle ||
    handle.includes(needle) ||
    nameKey.includes(needle) ||
    name.includes(q.toLowerCase().replace(/_/g, " "))
  );
}

const suppliersFile = path.join(DATA, "suppliers.json");
const settlementsFile = path.join(DATA, "settlements.json");
const withdrawalsFile = path.join(DATA, "withdrawals.json");
const ordersFile = path.join(DATA, "orders.json");

if (!existsSync(suppliersFile)) {
  console.error(`ERROR: missing ${suppliersFile}`);
  console.error("Run this on the bot VM from ~/sokoni (where whatsapp-bot/data lives).");
  process.exit(1);
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}

const suppliersStore = loadJson(suppliersFile, { suppliers: {} });
// Live shape: { suppliers: { "seller-…": { id, … } } } (not an array).
const suppliers = Array.isArray(suppliersStore)
  ? suppliersStore
  : asList(suppliersStore.suppliers || suppliersStore.items);

const matches = suppliers.filter((s) => matchSeller(s, sellerQuery));
if (matches.length === 0) {
  console.error(`ERROR: no supplier matched --seller ${sellerQuery}`);
  console.error(`Loaded ${suppliers.length} suppliers from ${suppliersFile}`);
  process.exit(1);
}
if (matches.length > 1) {
  console.error("ERROR: multiple suppliers matched — narrow --seller:");
  for (const s of matches) {
    console.error(`  - ${s.id}  @${s.shopHandle || "?"}  ${s.businessName || s.shopName || ""}`);
  }
  process.exit(1);
}

const seller = matches[0];
const supplierId = seller.id;
console.log("Target seller (ONLY this one will change):");
console.log(`  id:           ${supplierId}`);
console.log(`  handle:       @${seller.shopHandle || seller.handle || "?"}`);
console.log(`  name:         ${seller.businessName || seller.shopName || "?"}`);
console.log(`  mode:         ${apply ? "APPLY (writes)" : "DRY-RUN (no writes)"}`);
console.log(`  data dir:     ${DATA}`);

const settlements = loadJson(settlementsFile, { entries: [] });
const withdrawals = loadJson(withdrawalsFile, { seq: 0, requests: [] });
// Live shape: { seq, orders: { "SKN-…": {…} }, cartOrders: {…}, … }
const ordersStore = loadJson(ordersFile, { orders: {}, cartOrders: {} });
const orders = [
  ...asList(Array.isArray(ordersStore) ? ordersStore : ordersStore.orders),
  ...asList(ordersStore.cartOrders),
];

const sellerEntries = (settlements.entries || []).filter((e) => e.supplierId === supplierId);
const otherEntries = (settlements.entries || []).filter((e) => e.supplierId !== supplierId);
const kes = (n) => Number(n || 0);
const sumBy = (list, status) =>
  list.filter((e) => e.status === status).reduce((s, e) => s + kes(e.payoutAmountKes), 0);

console.log("\nSettlements for this seller:");
console.log(`  entries: ${sellerEntries.length}`);
console.log(`  owed:        KES ${sumBy(sellerEntries, "owed").toLocaleString()}`);
console.log(`  scheduled:   KES ${sumBy(sellerEntries, "scheduled").toLocaleString()}`);
console.log(`  disbursing:  KES ${sumBy(sellerEntries, "disbursing").toLocaleString()}`);
console.log(`  b2c_failed:  KES ${sumBy(sellerEntries, "b2c_failed").toLocaleString()}`);
console.log(`  paid:        KES ${sumBy(sellerEntries, "paid").toLocaleString()}`);
for (const e of sellerEntries.slice(0, 20)) {
  console.log(`    - ${e.orderId}  ${e.status}  KES ${kes(e.payoutAmountKes).toLocaleString()}`);
}

const sellerWithdrawals = (withdrawals.requests || []).filter((r) => r.supplierId === supplierId);
const otherWithdrawals = (withdrawals.requests || []).filter((r) => r.supplierId !== supplierId);
console.log(`\nWithdrawal requests for this seller: ${sellerWithdrawals.length}`);
for (const r of sellerWithdrawals) {
  console.log(`    - ${r.id}  ${r.status}  KES ${kes(r.amountKes).toLocaleString()}`);
}

const sellerOrders = orders.filter((o) => o.supplierId === supplierId && o.kind !== "cart_parent");
const wouldHeal = sellerOrders.filter((o) => {
  if (o.isPaidOut || o.status === "cancelled") return false;
  const escrow = String(o.escrowStatus || "").toLowerCase();
  if (escrow === "refunded") return false;
  return (
    escrow === "released" ||
    Boolean(o.escrowReleasedAt) ||
    String(o.payoutStatus || "").toLowerCase() === "owed"
  );
});
const pendingHeld = sellerOrders.filter(
  (o) =>
    o.customerPaymentStatus === "confirmed" &&
    String(o.escrowStatus || "").toLowerCase() === "held" &&
    !o.escrowReleasedAt &&
    o.status !== "delivered" &&
    o.status !== "cancelled"
);

console.log(`\nOrders that would re-heal into Ready if only settlements deleted: ${wouldHeal.length}`);
for (const o of wouldHeal.slice(0, 20)) {
  console.log(`    - ${o.id}  escrow=${o.escrowStatus || "?"}  payout=${o.payoutStatus || "?"}`);
}
console.log(`Pending held-escrow orders (buyer money still held): ${pendingHeld.length}`);
for (const o of pendingHeld.slice(0, 10)) {
  console.log(`    - ${o.id}`);
}

if (!apply) {
  console.log("\nDRY-RUN complete. Re-run with --apply to write.");
  console.log(
    "  node scripts/zero-seller-earnings.mjs --seller adiv_thrift --apply"
  );
  process.exit(0);
}

if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });

const backups = {
  settlements: backup(settlementsFile),
  withdrawals: backup(withdrawalsFile),
  orders: backup(ordersFile),
};
console.log("\nBackups:");
for (const [k, v] of Object.entries(backups)) {
  console.log(`  ${k}: ${v || "(no file)"}`);
}

// 1) Drop this seller's settlement lines only
settlements.entries = otherEntries;
writeFileSync(settlementsFile, JSON.stringify(settlements, null, 2) + "\n");

// 2) Drop this seller's withdrawal requests only
withdrawals.requests = otherWithdrawals;
writeFileSync(withdrawalsFile, JSON.stringify(withdrawals, null, 2) + "\n");

// 3) Latch released orders so heal cannot recreate Ready balance
let latched = 0;
let pendingCleared = 0;
for (const o of orders) {
  if (o.supplierId !== supplierId || o.kind === "cart_parent") continue;

  const escrow = String(o.escrowStatus || "").toLowerCase();
  const released =
    escrow === "released" ||
    Boolean(o.escrowReleasedAt) ||
    String(o.payoutStatus || "").toLowerCase() === "owed" ||
    String(o.payoutStatus || "").toLowerCase() === "paid" ||
    String(o.payoutStatus || "").toLowerCase() === "b2c_failed" ||
    String(o.payoutStatus || "").toLowerCase() === "disbursing";

  if (released && !o.isPaidOut && o.status !== "cancelled" && escrow !== "refunded") {
    o.isPaidOut = true;
    o.paidOutAt = o.paidOutAt || Date.now();
    o.payoutStatus = "paid";
    o.earningsZeroedAt = Date.now();
    o.earningsZeroedReason = "admin_test_reset_adiv_thrift";
    latched += 1;
  }

  if (clearPending) {
    const held =
      o.customerPaymentStatus === "confirmed" &&
      escrow === "held" &&
      !o.escrowReleasedAt &&
      o.status !== "cancelled";
    if (held) {
      // Test reset: remove from pending-escrow ledger without deleting the order.
      o.escrowStatus = "released";
      o.escrowReleasedAt = Date.now();
      o.isPaidOut = true;
      o.paidOutAt = Date.now();
      o.payoutStatus = "paid";
      o.earningsZeroedAt = Date.now();
      o.earningsZeroedReason = "admin_test_reset_adiv_thrift_pending";
      pendingCleared += 1;
    }
  }
}

// Orders were mutated in place (object-map values). Persist the store shape as-is.
if (Array.isArray(ordersStore)) {
  writeFileSync(ordersFile, JSON.stringify(orders, null, 2) + "\n");
} else {
  writeFileSync(ordersFile, JSON.stringify(ordersStore, null, 2) + "\n");
}

console.log("\nApplied:");
console.log(`  removed settlements: ${sellerEntries.length}`);
console.log(`  removed withdrawals: ${sellerWithdrawals.length}`);
console.log(`  orders latched isPaidOut: ${latched}`);
if (clearPending) console.log(`  pending-escrow cleared: ${pendingCleared}`);
console.log(`  other sellers untouched: settlements ${otherEntries.length}, withdrawals ${otherWithdrawals.length}`);
console.log("\nRestart not required for JSON reads; refresh Seller Hub / reply balance on WhatsApp.");
console.log("If the bot caches aggressively: pm2 restart sokoni-bot");
