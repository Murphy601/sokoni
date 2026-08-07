#!/usr/bin/env node
/**
 * Zero ONE seller's full M-Pesa Ledger (Seller Hub):
 *   • Locked in transit
 *   • Pending escrow
 *   • Ready for M-Pesa
 *
 * Does NOT delete products, shop profile, or other sellers.
 *
 * Usage (on bot VM):
 *   node scripts/zero-seller-earnings.mjs --seller adiv_thrift          # dry-run
 *   node scripts/zero-seller-earnings.mjs --seller adiv_thrift --apply  # write
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

const TRANSIT_STATUSES = new Set(["in_transit", "at_pickup_point", "label_ready"]);

const args = process.argv.slice(2);
const apply = args.includes("--apply");
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

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}

function sellerOrderNet(o) {
  return Math.round(
    Number(o.sellerNetKes ?? o.sellerPayoutKes ?? o.sourcePriceKes ?? 0) || 0
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

const suppliersStore = loadJson(suppliersFile, { suppliers: {} });
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
console.log(
  `  handle:       ${String(seller.shopHandle || seller.handle || "?").replace(/^@/, "@")}`
);
console.log(`  name:         ${seller.businessName || seller.shopName || "?"}`);
console.log(`  mode:         ${apply ? "APPLY (writes)" : "DRY-RUN (no writes)"}`);
console.log(`  data dir:     ${DATA}`);

const settlements = loadJson(settlementsFile, { entries: [] });
const withdrawals = loadJson(withdrawalsFile, { seq: 0, requests: [] });
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

const readyKes =
  sumBy(sellerEntries, "owed") +
  sumBy(sellerEntries, "b2c_failed") +
  sumBy(sellerEntries, "disbursing") +
  sumBy(sellerEntries, "scheduled");

console.log("\nSettlements → Ready for M-Pesa (and related):");
console.log(`  entries: ${sellerEntries.length} · total KES ${readyKes.toLocaleString()}`);
for (const e of sellerEntries.slice(0, 30)) {
  console.log(`    - ${e.orderId}  ${e.status}  KES ${kes(e.payoutAmountKes).toLocaleString()}`);
}

const sellerWithdrawals = (withdrawals.requests || []).filter((r) => r.supplierId === supplierId);
const otherWithdrawals = (withdrawals.requests || []).filter((r) => r.supplierId !== supplierId);
console.log(`\nWithdrawal requests: ${sellerWithdrawals.length}`);
for (const r of sellerWithdrawals) {
  console.log(`    - ${r.id}  ${r.status}  KES ${kes(r.amountKes).toLocaleString()}`);
}

const sellerOrders = orders.filter((o) => o.supplierId === supplierId && o.kind !== "cart_parent");

const pendingHeld = sellerOrders.filter(
  (o) =>
    o.customerPaymentStatus === "confirmed" &&
    String(o.escrowStatus || "").toLowerCase() === "held" &&
    !o.escrowReleasedAt &&
    o.status !== "delivered" &&
    o.status !== "cancelled"
);
const pendingKes = pendingHeld.reduce((s, o) => s + sellerOrderNet(o), 0);

const inTransit = sellerOrders.filter(
  (o) =>
    TRANSIT_STATUSES.has(String(o.shipmentStatus || "")) &&
    o.status !== "delivered" &&
    o.status !== "cancelled"
);
const transitKes = inTransit.reduce((s, o) => s + sellerOrderNet(o), 0);

const wouldHeal = sellerOrders.filter((o) => {
  if (o.isPaidOut || o.status === "cancelled") return false;
  const escrow = String(o.escrowStatus || "").toLowerCase();
  if (escrow === "refunded") return false;
  return (
    escrow === "released" ||
    Boolean(o.escrowReleasedAt) ||
    ["owed", "paid", "b2c_failed", "disbursing", "scheduled"].includes(
      String(o.payoutStatus || "").toLowerCase()
    )
  );
});

console.log("\nSeller Hub ledger (what the UI shows):");
console.log(`  Locked in transit:  KES ${transitKes.toLocaleString()}  (${inTransit.length} orders)`);
console.log(`  Pending escrow:     KES ${pendingKes.toLocaleString()}  (${pendingHeld.length} orders)`);
console.log(`  Ready for M-Pesa:   KES ${readyKes.toLocaleString()}  (${sellerEntries.length} settlements)`);
for (const o of inTransit.slice(0, 15)) {
  console.log(`    transit  ${o.id}  ${o.shipmentStatus}  KES ${sellerOrderNet(o).toLocaleString()}`);
}
for (const o of pendingHeld.slice(0, 15)) {
  console.log(`    pending  ${o.id}  KES ${sellerOrderNet(o).toLocaleString()}`);
}
console.log(`  Heal risk orders (would recreate Ready): ${wouldHeal.length}`);

if (!apply) {
  console.log("\nDRY-RUN complete. Re-run with --apply to zero ALL three buckets.");
  console.log("  node scripts/zero-seller-earnings.mjs --seller adiv_thrift --apply");
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

// 1) Drop this seller's settlement lines → Ready = 0
settlements.entries = otherEntries;
writeFileSync(settlementsFile, JSON.stringify(settlements, null, 2) + "\n");

// 2) Drop this seller's withdrawal requests
withdrawals.requests = otherWithdrawals;
writeFileSync(withdrawalsFile, JSON.stringify(withdrawals, null, 2) + "\n");

// 3) Clear order fields that feed Pending / In transit / Ready heal
let latched = 0;
let pendingCleared = 0;
let transitCleared = 0;

for (const o of orders) {
  if (o.supplierId !== supplierId || o.kind === "cart_parent") continue;
  if (o.status === "cancelled") continue;

  const escrow = String(o.escrowStatus || "").toLowerCase();
  let touched = false;

  // Ready heal latch — any paid/released/payout-tagged order
  const needsLatch =
    !o.isPaidOut &&
    escrow !== "refunded" &&
    (escrow === "released" ||
      Boolean(o.escrowReleasedAt) ||
      o.customerPaymentStatus === "confirmed" ||
      ["owed", "paid", "b2c_failed", "disbursing", "scheduled"].includes(
        String(o.payoutStatus || "").toLowerCase()
      ));

  if (needsLatch) {
    o.isPaidOut = true;
    o.paidOutAt = o.paidOutAt || Date.now();
    o.payoutStatus = "paid";
    touched = true;
    latched += 1;
  }

  // Pending escrow → 0
  const held =
    o.customerPaymentStatus === "confirmed" &&
    escrow === "held" &&
    !o.escrowReleasedAt &&
    o.status !== "delivered";
  if (held) {
    o.escrowStatus = "released";
    o.escrowReleasedAt = Date.now();
    o.isPaidOut = true;
    o.paidOutAt = Date.now();
    o.payoutStatus = "paid";
    touched = true;
    pendingCleared += 1;
  }

  // Locked in transit → 0 (drop shipment statuses the ledger counts)
  const ship = String(o.shipmentStatus || "");
  if (TRANSIT_STATUSES.has(ship) && o.status !== "delivered") {
    o.shipmentStatusBeforeZero = ship;
    o.shipmentStatus = "cleared_test_reset";
    touched = true;
    transitCleared += 1;
  }

  if (touched) {
    o.earningsZeroedAt = Date.now();
    o.earningsZeroedReason = "admin_test_reset_full_ledger";
  }
}

if (Array.isArray(ordersStore)) {
  writeFileSync(ordersFile, JSON.stringify(orders, null, 2) + "\n");
} else {
  writeFileSync(ordersFile, JSON.stringify(ordersStore, null, 2) + "\n");
}

console.log("\nApplied — Seller Hub should show KES 0 / 0 / 0:");
console.log(`  removed settlements:     ${sellerEntries.length}`);
console.log(`  removed withdrawals:     ${sellerWithdrawals.length}`);
console.log(`  orders latched isPaidOut:${latched}`);
console.log(`  pending-escrow cleared:  ${pendingCleared}`);
console.log(`  in-transit cleared:      ${transitCleared}`);
console.log(
  `  other sellers untouched: settlements ${otherEntries.length}, withdrawals ${otherWithdrawals.length}`
);
console.log("\nHard refresh Seller Hub (Refresh), or: pm2 restart sokoni-bot");
