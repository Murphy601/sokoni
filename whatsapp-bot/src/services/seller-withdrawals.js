/**
 * Seller manual M-Pesa withdrawal requests (available balance → payout number).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuthenticatedSeller } from "./seller-onboard.js";
import { healReleasedSellerPayouts } from "./settlements.js";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WITHDRAWALS_FILE = path.join(__dirname, "..", "..", "data", "withdrawals.json");
const SETTLEMENTS_FILE = path.join(__dirname, "..", "..", "data", "settlements.json");

function loadWithdrawals() {
  try {
    if (existsSync(WITHDRAWALS_FILE)) {
      return { seq: 0, requests: [], ...JSON.parse(readFileSync(WITHDRAWALS_FILE, "utf-8")) };
    }
  } catch {}
  return { seq: 0, requests: [] };
}

function saveWithdrawals(store) {
  const dir = path.dirname(WITHDRAWALS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(WITHDRAWALS_FILE, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

function loadSettlements() {
  try {
    if (existsSync(SETTLEMENTS_FILE)) {
      return JSON.parse(readFileSync(SETTLEMENTS_FILE, "utf-8"));
    }
  } catch {}
  return { entries: [] };
}

function maskMpesa(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 4) return "—";
  return `***${d.slice(-4)}`;
}

function nextWithdrawId(store) {
  store.seq = (store.seq || 0) + 1;
  const year = new Date().getFullYear();
  return `WD-${year}-${String(store.seq).padStart(4, "0")}`;
}

/** Settlement lines eligible for manual withdraw (Ready for M-Pesa). */
export function getWithdrawableEntries(supplierId) {
  try {
    healReleasedSellerPayouts(supplierId);
  } catch (err) {
    console.warn("[withdrawals] payout heal skipped:", err?.message || err);
  }
  const settlements = loadSettlements();
  return (settlements.entries || []).filter(
    (e) =>
      e.supplierId === supplierId && (e.status === "owed" || e.status === "b2c_failed")
  );
}

export function getSellerWithdrawSummaryByPhone(phone, sessionToken) {
  return getSellerWithdrawSummaryAsync(phone, sessionToken);
}

export async function getSellerWithdrawSummaryAsync(phone, sessionToken) {
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;

  const supplier = check.supplier;
  const owed = getWithdrawableEntries(supplier.id);
  const store = loadWithdrawals();
  const mine = (store.requests || []).filter((r) => r.supplierId === supplier.id);
  const pendingRequest = mine.find((r) => r.status === "pending") || null;
  const history = mine
    .filter((r) => r.status !== "pending")
    .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0))
    .slice(0, 20);

  const availableKes = owed.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);

  return {
    availableKes,
    mpesaNumber: supplier.mpesaNumber || supplier.phone,
    maskedMpesa: maskMpesa(supplier.mpesaNumber || supplier.phone),
    pendingRequest,
    history,
    breakdown: owed.map((e) => ({
      orderId: e.orderId,
      productName: e.productName,
      amountKes: e.payoutAmountKes,
    })),
    seller: {
      id: supplier.id,
      businessName: supplier.businessName,
    },
  };
}

async function notifyAdminWithdrawal(request, supplier) {
  try {
    const { sendText, toChatId } = await import("./whatsapp.js");
    const adminPhone = config.admin?.primary;
    if (!adminPhone) return;
    const adminId = toChatId(adminPhone);
    await sendText(
      adminId,
      `💸 *Manual withdraw request — ${request.id}*\n\n` +
        `Seller: *${supplier.businessName || supplier.id}*\n` +
        `M-Pesa: *${request.mpesaNumber}*\n` +
        `Amount: *KES ${request.amountKes.toLocaleString()}*\n` +
        `Orders: ${request.orderIds.join(", ")}\n\n` +
        `_Pay via M-Pesa, then mark paid: #paid ${request.orderIds[0]}_`
    );
  } catch (err) {
    console.warn("[withdrawals] admin notify failed:", err.message);
  }
}

export async function requestSellerWithdrawal(phone, sessionToken) {
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;
  return createWithdrawalRequest(check.supplier);
}

/** WhatsApp-only withdraw — seller messaging from their registered phone. */
export async function requestSellerWithdrawalByPhone(phone) {
  const { requireSeller } = await import("./seller-onboard.js");
  const check = requireSeller(phone);
  if (check.error) return check;
  return createWithdrawalRequest(check.supplier);
}

async function createWithdrawalRequest(supplier) {
  const mpesaNumber = supplier.mpesaNumber || supplier.phone;
  if (!mpesaNumber) {
    return { error: "missing_mpesa", message: "Add your M-Pesa payout number in seller profile." };
  }

  const store = loadWithdrawals();
  const existingPending = (store.requests || []).find(
    (r) => r.supplierId === supplier.id && r.status === "pending"
  );
  if (existingPending) {
    return {
      error: "withdrawal_pending",
      message: `Withdrawal ${existingPending.id} is already processing.`,
      request: existingPending,
    };
  }

  const owed = getWithdrawableEntries(supplier.id);
  if (!owed.length) {
    return {
      error: "no_balance",
      message: "Nothing to withdraw yet — earnings appear here after delivery and escrow release.",
    };
  }

  const amountKes = owed.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  const request = {
    id: nextWithdrawId(store),
    supplierId: supplier.id,
    supplierName: supplier.businessName,
    phone: supplier.phone,
    mpesaNumber,
    amountKes,
    orderIds: owed.map((e) => e.orderId),
    status: "pending",
    requestedAt: Date.now(),
    paidAt: null,
  };

  store.requests = store.requests || [];
  store.requests.unshift(request);
  if (store.requests.length > 500) store.requests.length = 500;
  saveWithdrawals(store);

  await notifyAdminWithdrawal(request, supplier);

  return {
    ok: true,
    request,
    message: `Withdrawal requested — KES ${amountKes.toLocaleString()} to M-Pesa ${maskMpesa(mpesaNumber)}. Manual transfer within 1–2 business days.`,
  };
}
