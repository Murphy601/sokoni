#!/usr/bin/env node
/**
 * Keep ONE Ready order for a Paystack withdraw test. Clears stuck WD-*
 * requests (those block the Withdraw button) and other ledger lines.
 *
 * Usage on the bot VM:
 *   node scripts/retain-order-for-withdraw-test.mjs --order SKN-1013
 *   node scripts/retain-order-for-withdraw-test.mjs --order SKN-1013 --apply
 *   node scripts/retain-order-for-withdraw-test.mjs --order SKN-1013 --withdrawals-only --apply
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DATA = process.env.SOKONI_DATA_DIR || path.join(REPO, "whatsapp-bot", "data");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const skipPm2 = args.includes("--skip-pm2");
const withdrawalsOnly = args.includes("--withdrawals-only");
const orderIdx = args.indexOf("--order");
const keepId = String(orderIdx >= 0 ? args[orderIdx + 1] : "SKN-1013")
  .trim()
  .toUpperCase();

if (!/^SKN-\d+/.test(keepId)) {
  console.error("Usage: node scripts/retain-order-for-withdraw-test.mjs --order SKN-1013 [--apply]");
  process.exit(1);
}

function pm2(cmd) {
  if (skipPm2) {
    console.log(`(skip pm2 ${cmd})`);
    return;
  }
  try {
    execSync(`pm2 ${cmd} sokoni-bot`, { stdio: "inherit" });
  } catch (err) {
    console.warn(`WARN: pm2 ${cmd} sokoni-bot failed:`, err.message);
  }
}

function loadJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf-8"));
}

function backup(file) {
  if (!existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.bak-retain-${keepId}-${stamp}`;
  copyFileSync(file, dest);
  return dest;
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}

const settlementsFile = path.join(DATA, "settlements.json");
const withdrawalsFile = path.join(DATA, "withdrawals.json");
const ordersFile = path.join(DATA, "orders.json");

if (!existsSync(ordersFile)) {
  console.error(`ERROR: missing ${ordersFile}`);
  process.exit(1);
}

const ordersStore = loadJson(ordersFile, { orders: {}, cartOrders: {} });
const ordersMap = ordersStore.orders && !Array.isArray(ordersStore) ? ordersStore.orders : null;
const cartMap = ordersStore.cartOrders || {};
const keep =
  (ordersMap && (ordersMap[keepId] || ordersMap[keepId.toLowerCase()])) ||
  cartMap[keepId] ||
  asList(ordersStore.orders).find((o) => String(o.id || "").toUpperCase() === keepId) ||
  asList(cartMap).find((o) => String(o.id || "").toUpperCase() === keepId);

if (!keep) {
  console.error(`ERROR: ${keepId} not found in ${ordersFile}`);
  process.exit(1);
}

const supplierId = keep.supplierId;
const settlements = loadJson(settlementsFile, { entries: [] });
const withdrawals = loadJson(withdrawalsFile, { seq: 0, requests: [] });
const sellerEntries = (settlements.entries || []).filter((e) => e.supplierId === supplierId);
const keepEntry = sellerEntries.find((e) => String(e.orderId || "").toUpperCase() === keepId);
const sellerWithdrawals = (withdrawals.requests || []).filter((r) => r.supplierId === supplierId);
const blocking = sellerWithdrawals.filter((r) => r.status === "pending" || r.status === "processing");

console.log("Keep for withdraw test:");
console.log(`  order:        ${keep.id}  ${keep.productName || ""}`);
console.log(`  seller:       ${keep.supplierName || supplierId}`);
console.log(`  supplierId:   ${supplierId}`);
console.log(`  mpesa:        ${keepEntry?.mpesaPhone || keep.mpesaPhone || "—"}`);
console.log(`  settlement:   ${keepEntry ? `${keepEntry.status} KES ${keepEntry.payoutAmountKes}` : "MISSING — will create owed"}`);
console.log(`  mode:         ${apply ? "APPLY" : "DRY-RUN"}${withdrawalsOnly ? " (withdrawals only)" : ""}`);
console.log(`\nThis seller's other Ready lines: ${sellerEntries.length - (keepEntry ? 1 : 0)}`);
for (const e of sellerEntries) {
  if (String(e.orderId || "").toUpperCase() === keepId) continue;
  console.log(`    drop  ${e.orderId}  ${e.status}  KES ${e.payoutAmountKes}`);
}
console.log(`\nWithdrawals (stuck pending/processing block the button): ${sellerWithdrawals.length}`);
for (const r of sellerWithdrawals) {
  const flag = r.status === "pending" || r.status === "processing" ? " BLOCKING" : "";
  console.log(`    ${r.id}  ${r.status}  KES ${r.amountKes}${flag}`);
}

if (!apply) {
  console.log("\nDRY-RUN. Re-run with --apply to write (stops/starts sokoni-bot).");
  console.log(`  node scripts/retain-order-for-withdraw-test.mjs --order ${keepId} --apply`);
  console.log(`  node scripts/retain-order-for-withdraw-test.mjs --order ${keepId} --withdrawals-only --apply`);
  process.exit(0);
}

console.log("\n==> Stopping sokoni-bot");
pm2("stop");

console.log("Backups:");
const backupTargets = withdrawalsOnly
  ? { withdrawals: backup(withdrawalsFile) }
  : {
      settlements: backup(settlementsFile),
      withdrawals: backup(withdrawalsFile),
      orders: backup(ordersFile),
    };
for (const [k, v] of Object.entries(backupTargets)) {
  console.log(`  ${k}: ${v || "(none)"}`);
}

if (withdrawalsOnly) {
  const nowStuck = Date.now();
  withdrawals.requests = (withdrawals.requests || []).map((r) => {
    if (r.supplierId !== supplierId) return r;
    if (r.status !== "pending" && r.status !== "processing") return r;
    return {
      ...r,
      status: "cancelled",
      cancelledAt: nowStuck,
      cancelReason: `cleared so ${keepId} withdraw can retry`,
    };
  });
  writeFileSync(withdrawalsFile, JSON.stringify(withdrawals, null, 2) + "\n");
  console.log("\nApplied withdrawals-only:");
  console.log(`  Blocking WD cleared: ${blocking.map((r) => r.id).join(", ") || "none"}`);
  console.log("\n==> Starting sokoni-bot");
  pm2("start");
  console.log("Refresh Seller Hub → Escrow & withdraw. Then tap Withdraw to M-Pesa.");
  process.exit(0);
}

const now = Date.now();
const keepPayout = Math.round(
  Number(keepEntry?.payoutAmountKes || keep.sellerPayoutKes || keep.sellerNetKes || keep.sourcePriceKes) || 0
);

settlements.entries = (settlements.entries || []).filter((e) => {
  if (e.supplierId !== supplierId) return true;
  return String(e.orderId || "").toUpperCase() === keepId;
});
if (keepEntry) {
  keepEntry.status = "owed";
  keepEntry.payoutEligibleAt = now;
  keepEntry.b2c = null;
  keepEntry.paystack = null;
  delete keepEntry.disburseLockedAt;
} else if (keepPayout > 0) {
  settlements.entries.unshift({
    id: `PAY-${keep.id}`,
    orderId: keep.id,
    supplierId,
    supplierName: keep.supplierName || "",
    mpesaPhone: keep.mpesaPhone || "",
    productName: keep.productName,
    payoutAmountKes: keepPayout,
    status: "owed",
    payoutEligibleAt: now,
    createdAt: now,
    paidAt: null,
  });
}
writeFileSync(settlementsFile, JSON.stringify(settlements, null, 2) + "\n");

withdrawals.requests = (withdrawals.requests || []).map((r) => {
  if (r.supplierId !== supplierId) return r;
  if (r.status !== "pending" && r.status !== "processing") return r;
  return {
    ...r,
    status: "cancelled",
    cancelledAt: now,
    cancelReason: `cleared so ${keepId} withdraw test can run`,
  };
});
writeFileSync(withdrawalsFile, JSON.stringify(withdrawals, null, 2) + "\n");

const touchOrder = (o) => {
  if (!o || String(o.id || "").toUpperCase() === keepId) return;
  if (o.supplierId !== supplierId) return;
  if (o.kind === "cart_parent") return;
  o.status = "cancelled";
  o.cancelledAt = now;
  o.cancelReason = `retain-only ${keepId} withdraw test`;
  o.isPaidOut = true;
  o.paidOutAt = now;
  o.payoutStatus = "paid";
  o.escrowStatus = o.escrowStatus === "held" ? "released" : o.escrowStatus;
  o.escrowReleasedAt = o.escrowReleasedAt || now;
};

if (ordersMap) {
  for (const o of Object.values(ordersMap)) touchOrder(o);
  for (const o of Object.values(cartMap)) touchOrder(o);
  keep.status = keep.status === "cancelled" ? "delivered" : keep.status;
  keep.payoutStatus = "owed";
  keep.isPaidOut = false;
  delete keep.paidOutAt;
  writeFileSync(ordersFile, JSON.stringify(ordersStore, null, 2) + "\n");
}

const verify = loadJson(settlementsFile, { entries: [] });
const left = (verify.entries || []).filter((e) => e.supplierId === supplierId);
console.log("\nApplied:");
console.log(`  Ready lines left: ${left.length}  (${left.map((e) => `${e.orderId} ${e.status} KES ${e.payoutAmountKes}`).join(", ")})`);
console.log(`  Blocking WD cleared: ${blocking.map((r) => r.id).join(", ") || "none"}`);
console.log("\n==> Starting sokoni-bot");
pm2("start");
console.log("Refresh Seller Hub → Escrow & withdraw. Then tap Withdraw to M-Pesa.");
