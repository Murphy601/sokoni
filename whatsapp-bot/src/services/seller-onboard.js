/**
 * Depop-style peer seller onboarding — WhatsApp phone + M-Pesa payout setup.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPeerSeller, findSupplierByPhone } from "./suppliers.js";
import { getOrder } from "./orders.js";
import { readFileSync, existsSync as fsExists } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTLEMENTS_FILE = path.join(__dirname, "..", "..", "data", "settlements.json");
const MASTER_CATALOG = path.join(__dirname, "..", "data", "products.json");
const REPO_CATALOG = path.join(__dirname, "..", "..", "..", "website", "data", "products.json");

export function normalizePhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

export function isValidMpesaNumber(mpesaNumber) {
  const d = normalizePhone(mpesaNumber);
  return /^2547\d{8}$/.test(d) || /^2541\d{8}$/.test(d);
}

export function requireSeller(phone) {
  const supplier = findSupplierByPhone(phone);
  if (!supplier) {
    return {
      error: "not_onboarded",
      message: "Set up your shop first — shop name and M-Pesa number.",
    };
  }
  return { supplier };
}

export function onboardSeller({ phone, shopName, shopHandle, mpesaNumber, nationalId }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || normalizedPhone.length < 12) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number (07xx or 2547xx)." };
  }
  if (!String(shopName || "").trim()) {
    return { error: "missing_shop", message: "Shop name is required." };
  }
  if (!isValidMpesaNumber(mpesaNumber)) {
    return { error: "invalid_mpesa", message: "Invalid M-Pesa number — use 2547XXXXXXXX format." };
  }

  const result = createPeerSeller({
    phone: normalizedPhone,
    shopName: String(shopName).trim(),
    shopHandle: String(shopHandle || shopName).trim(),
    mpesaNumber: normalizePhone(mpesaNumber),
    nationalId,
  });

  return {
    success: true,
    seller: sanitizeSeller(result.supplier),
    existing: result.existing,
    message: result.existing ? "Shop profile updated." : "Shop created — add your first listing.",
  };
}

function sanitizeSeller(s) {
  if (!s) return null;
  return {
    id: s.id,
    businessName: s.businessName,
    shopHandle: s.shopHandle || null,
    phone: s.phone,
    mpesaNumber: s.mpesaNumber || null,
    isSellerVerified: Boolean(s.isSellerVerified),
    role: s.role || "SELLER",
    city: s.city || "",
  };
}

export function getSellerProfile(phone) {
  const check = requireSeller(phone);
  if (check.error) return check;
  return { seller: sanitizeSeller(check.supplier) };
}

function loadSettlements() {
  try {
    if (fsExists(SETTLEMENTS_FILE)) {
      return JSON.parse(readFileSync(SETTLEMENTS_FILE, "utf-8"));
    }
  } catch {}
  return { entries: [] };
}

function loadAllOrders() {
  const ordersFile = path.join(__dirname, "..", "..", "data", "orders.json");
  try {
    if (fsExists(ordersFile)) {
      const store = JSON.parse(readFileSync(ordersFile, "utf-8"));
      return Object.values(store.orders || {});
    }
  } catch {}
  return [];
}

/** Escrow ledger: available / pending / in transit for seller dashboard. */
export function getSellerEscrowLedger(supplierId) {
  const settlements = loadSettlements();
  const orders = loadAllOrders().filter((o) => o.supplierId === supplierId);

  const sellerEntries = settlements.entries.filter((e) => e.supplierId === supplierId);

  const available = sellerEntries
    .filter((e) => e.status === "owed" || e.status === "paid")
    .map((e) => ({
      orderId: e.orderId,
      amountKes: e.payoutAmountKes,
      status: e.status === "paid" ? "paid" : "available",
      productName: e.productName,
    }));

  const pendingEscrow = orders
    .filter(
      (o) =>
        o.customerPaymentStatus === "confirmed" &&
        o.escrowStatus === "held" &&
        o.status !== "delivered" &&
        o.status !== "cancelled"
    )
    .map((o) => ({
      orderId: o.id,
      amountKes: o.sourcePriceKes || Math.round((o.priceKes || 0) * 0.92),
      status: "pending",
      productName: o.productName,
      trackingCode: o.id,
    }));

  const inTransit = orders
    .filter(
      (o) =>
        ["in_transit", "at_pickup_point", "label_ready"].includes(o.shipmentStatus) &&
        o.status !== "delivered" &&
        o.status !== "cancelled"
    )
    .map((o) => ({
      orderId: o.id,
      amountKes: o.sourcePriceKes || Math.round((o.priceKes || 0) * 0.92),
      status: "in_transit",
      productName: o.productName,
      trackingCode: o.id,
      shipmentStatus: o.shipmentStatus,
    }));

  const availableTotal = available
    .filter((e) => e.status === "available")
    .reduce((s, e) => s + (e.amountKes || 0), 0);
  const pendingTotal = pendingEscrow.reduce((s, e) => s + (e.amountKes || 0), 0);
  const transitTotal = inTransit.reduce((s, e) => s + (e.amountKes || 0), 0);

  return {
    available: { totalKes: availableTotal, items: available },
    pendingEscrow: { totalKes: pendingTotal, items: pendingEscrow },
    inTransit: { totalKes: transitTotal, items: inTransit },
  };
}

export function getSellerEscrowLedgerByPhone(phone) {
  const check = requireSeller(phone);
  if (check.error) return check;
  return { ledger: getSellerEscrowLedger(check.supplier.id), seller: sanitizeSeller(check.supplier) };
}

/** Bump listing to top of feed without re-uploading photos. */
export async function refreshSellerListing({ phone, productId }) {
  const check = requireSeller(phone);
  if (check.error) return check;

  const paths = [MASTER_CATALOG, REPO_CATALOG].filter((p) => existsSync(p));
  let updated = null;

  for (const file of paths) {
    try {
      const products = JSON.parse(await readFile(file, "utf-8"));
      const idx = products.findIndex((p) => p.id === productId && p.supplierId === check.supplier.id);
      if (idx === -1) continue;
      products[idx] = {
        ...products[idx],
        publishedAt: Date.now(),
        refreshedAt: Date.now(),
      };
      await writeFile(file, JSON.stringify(products, null, 2) + "\n", "utf-8");
      updated = products[idx];
    } catch (err) {
      console.warn("[seller-onboard] refresh failed:", file, err.message);
    }
  }

  if (!updated) {
    return { error: "not_found", message: "Listing not found or not yours." };
  }

  try {
    const { execSync } = await import("node:child_process");
    execSync("node scripts/build-site-catalog.mjs", {
      cwd: path.join(__dirname, "..", "..", ".."),
      stdio: "pipe",
    });
  } catch {}

  return {
    success: true,
    productId,
    refreshedAt: updated.refreshedAt,
    message: "Listing refreshed — pushed back up the feed.",
  };
}

/** Confirm delivery and trigger escrow payout scheduling. */
export async function confirmOrderDelivery(orderId) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found", message: "Order not found." };
  if (order.status === "delivered") {
    return { order, skipped: true, message: "Already marked delivered." };
  }

  const { updateOrderStatus } = await import("./orders.js");
  const { advanceShipmentStatus } = await import("./shipments.js");

  updateOrderStatus(orderId, "delivered");
  advanceShipmentStatus(orderId, "delivered", {
    note: "Delivery confirmed via API",
    actor: "confirm_delivery_api",
  });

  const { onOrderDelivered } = await import("./escrow-automation.js");
  onOrderDelivered(getOrder(orderId) || order);

  const fresh = getOrder(orderId);
  const payout = await releaseEscrowPayout(orderId);

  return {
    success: true,
    order: fresh,
    payout,
    message: "Delivery confirmed — seller payout scheduled.",
  };
}

/** Release escrow payout via M-Pesa B2C when order is delivered. */
export async function releaseEscrowPayout(orderId) {
  const order = getOrder(orderId);
  if (!order) return { error: "not_found" };
  if (order.isPaidOut) return { skipped: true, message: "Already paid out." };
  if (order.status !== "delivered") {
    return { error: "not_delivered", message: "Order must be delivered first." };
  }

  const { getSupplier } = await import("./suppliers.js");
  const seller = getSupplier(order.supplierId);
  const mpesaPhone = seller?.mpesaNumber || seller?.phone;
  const netAmount = order.sourcePriceKes || Math.round((order.priceKes || 0) * 0.92);

  if (!mpesaPhone) {
    return { error: "no_mpesa", message: "Seller M-Pesa number not on file." };
  }

  const { initiateB2CPayout } = await import("./daraja-mpesa.js");
  let payoutResult;
  try {
    payoutResult = await initiateB2CPayout({
      phone: mpesaPhone,
      amount: netAmount,
      remarks: `Payout for Order #${order.id}`,
    });
  } catch (err) {
    payoutResult = { ok: false, error: err.message };
  }

  const { updateOrderMeta } = await import("./orders.js");
  const { scheduleSellerPayoutAfterDelivery } = await import("./settlements.js");

  if (payoutResult.ok) {
    updateOrderMeta(orderId, { isPaidOut: true, payoutStatus: "paid", paidOutAt: Date.now() });
    return { success: true, payoutResult, netAmount, mpesaPhone };
  }

  scheduleSellerPayoutAfterDelivery({ ...order, sourcePriceKes: netAmount });
  updateOrderMeta(orderId, { payoutStatus: "scheduled", isPaidOut: false });

  return {
    success: true,
    scheduled: true,
    payoutResult,
    netAmount,
    message: payoutResult.stub
      ? "Payout scheduled — B2C API pending, manual transfer for now."
      : "Payout scheduled after escrow hold.",
  };
}
