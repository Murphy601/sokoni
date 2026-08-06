/**
 * Depop-style peer seller onboarding — WhatsApp phone + M-Pesa payout setup.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPeerSeller, findSupplierByPhone } from "./suppliers.js";
import { getOrder } from "./orders.js";
import { orderBuyerTotal, resolveSellerPayoutKes, computeFeeBreakdown } from "./shipping-tiers.js";
import { shipmentStatusLabel } from "./shipments.js";
import { config } from "../config.js";
import { labelPageUrlForOrder } from "./prepaid-checkout.js";
import { readFileSync, existsSync as fsExists } from "node:fs";
import { validateSellerSession } from "./seller-verification.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTLEMENTS_FILE = path.join(__dirname, "..", "..", "data", "settlements.json");
const MASTER_CATALOG = path.join(__dirname, "..", "data", "products.json");
const REPO_CATALOG = path.join(__dirname, "..", "..", "..", "website", "data", "products.json");

function sellerOrderNet(o) {
  const payout = resolveSellerPayoutKes(o);
  if (payout > 0) return payout;
  return o.sellerNetKes ?? o.sourcePriceKes ?? Math.round(orderBuyerTotal(o) * 0.9);
}

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
      message: "Set up your seller profile first — name and M-Pesa number.",
    };
  }
  return { supplier };
}

/** Require valid WhatsApp OTP session + onboarded seller profile. */
export async function requireAuthenticatedSeller(phone, sessionToken) {
  const session = await validateSellerSession(phone, sessionToken);
  if (session.error) return session;
  return requireSeller(phone);
}

/** New and returning sellers must verify WhatsApp OTP before every sign-in. */
export async function onboardSellerAsync(payload) {
  const { phone, shopName, shopHandle, mpesaNumber, nationalId, sessionToken, verificationToken } =
    payload || {};
  const token = sessionToken || verificationToken;
  const session = await validateSellerSession(phone, token);
  if (session.error) return session;

  const result = onboardSeller({ phone, shopName, shopHandle, mpesaNumber, nationalId });
  if (result.error) return result;

  // Provision Postgres users + sellers so activity / public shop / PATCH profile work.
  try {
    const { isDbEnabled } = await import("../db/pool.js");
    if (isDbEnabled()) {
      const { ensureSellerSocialProfile } = await import("../db/repositories/users.js");
      const ensured = await ensureSellerSocialProfile({
        phone: result.seller?.phone || session.phone,
        handle: result.seller?.shopHandle || shopHandle || shopName,
        shopName: result.seller?.businessName || shopName,
        location: result.seller?.city || null,
        mpesaNumber: result.seller?.mpesaNumber || mpesaNumber,
        isVerified: true,
      });
      if (!ensured.error && ensured.user?.handle) {
        result.seller = {
          ...result.seller,
          shopHandle: ensured.user.handle.startsWith("@")
            ? ensured.user.handle
            : `@${ensured.user.handle}`,
          socialUserId: ensured.user.id,
          dbSellerId: ensured.seller?.id || null,
        };
      } else if (ensured.error) {
        console.warn("[seller-onboard] social profile ensure failed:", ensured.error, ensured.message);
      }
    }
  } catch (err) {
    console.warn("[seller-onboard] social profile ensure skipped:", err.message);
  }

  return result;
}

export function onboardSeller({ phone, shopName, shopHandle, mpesaNumber, nationalId }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || normalizedPhone.length < 12) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number (07xx or 2547xx)." };
  }
  if (!String(shopName || "").trim()) {
    return { error: "missing_shop", message: "Enter your name or shop name." };
  }
  if (!isValidMpesaNumber(mpesaNumber)) {
    return { error: "invalid_mpesa", message: "Enter a valid M-Pesa number (07xx or 2547xx)." };
  }

  const result = createPeerSeller({
    phone: normalizedPhone,
    shopName: String(shopName).trim(),
    shopHandle: String(shopHandle || shopName).trim(),
    mpesaNumber: normalizePhone(mpesaNumber),
    nationalId,
    whatsappChatId: `${normalizedPhone}@c.us`,
  });

  return {
    success: true,
    seller: sanitizeSeller(result.supplier),
    existing: result.existing,
    message: result.existing ? "Profile updated." : "You're set up — add your first listing below.",
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

export async function getSellerProfile(phone, sessionToken) {
  const session = await validateSellerSession(phone, sessionToken);
  if (session.error) return session;

  const check = requireSeller(phone);
  if (check.error) {
    return { needsSetup: true, error: check.error, message: check.message };
  }
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

function sellerLabelUrl(orderId) {
  return labelPageUrlForOrder(orderId);
}

/** Seller dashboard — paid orders, labels, shipment status (Phases 5–6). */
export function getSellerOrders(supplierId) {
  return loadAllOrders()
    .filter((o) => o.supplierId === supplierId && o.status !== "cancelled")
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((o) => {
      const paid = o.customerPaymentStatus === "confirmed";
      const shipmentStatus = o.shipmentStatus || "pending";
      const needsDropOff =
        paid && ["pending", "label_ready"].includes(shipmentStatus) && o.status !== "delivered";

      return {
        orderId: o.id,
        productId: o.productId || null,
        productName: o.productName,
        quantity: Math.max(1, Math.round(Number(o.quantity) || 1)),
        sellerNetKes: sellerOrderNet(o),
        paid,
        shipmentStatus,
        shipmentStatusLabel: shipmentStatusLabel(shipmentStatus),
        needsDropOff,
        labelUrl: paid ? sellerLabelUrl(o.id) : null,
        trackUrl: `${config.publicSiteUrl}/track.html?order=${encodeURIComponent(o.id)}`,
        createdAt: o.createdAt,
      };
    });
}

export async function getSellerOrdersByPhone(phone, sessionToken) {
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;
  return { orders: getSellerOrders(check.supplier.id), seller: sanitizeSeller(check.supplier) };
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
      amountKes: sellerOrderNet(o),
      status: "pending",
      productName: o.productName,
      trackingCode: o.id,
      shipmentStatusLabel: shipmentStatusLabel(o.shipmentStatus || "pending"),
      trackUrl: `${config.publicSiteUrl}/track.html?order=${encodeURIComponent(o.id)}`,
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
      amountKes: sellerOrderNet(o),
      status: "in_transit",
      productName: o.productName,
      trackingCode: o.id,
      shipmentStatus: o.shipmentStatus,
      shipmentStatusLabel: shipmentStatusLabel(o.shipmentStatus),
      trackUrl: `${config.publicSiteUrl}/track.html?order=${encodeURIComponent(o.id)}`,
    }));

  const availableTotal = available
    .filter((e) => e.status === "available")
    .reduce((s, e) => s + (e.amountKes || 0), 0);
  const paidOutItems = available.filter((e) => e.status === "paid");
  const paidOutTotal = paidOutItems.reduce((s, e) => s + (e.amountKes || 0), 0);
  const pendingTotal = pendingEscrow.reduce((s, e) => s + (e.amountKes || 0), 0);
  const transitTotal = inTransit.reduce((s, e) => s + (e.amountKes || 0), 0);

  return {
    available: { totalKes: availableTotal, items: available.filter((e) => e.status === "available") },
    paidOut: { totalKes: paidOutTotal, items: paidOutItems },
    pendingEscrow: { totalKes: pendingTotal, items: pendingEscrow },
    inTransit: { totalKes: transitTotal, items: inTransit },
  };
}

export async function getSellerEscrowLedgerByPhone(phone, sessionToken) {
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;
  return { ledger: getSellerEscrowLedger(check.supplier.id), seller: sanitizeSeller(check.supplier) };
}

/** Bump listing to top of feed without re-uploading photos. */
export async function refreshSellerListing({ phone, productId, sessionToken }) {
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;

  const paths = [MASTER_CATALOG, REPO_CATALOG].filter((p) => existsSync(p));
  let updated = null;

  for (const file of paths) {
    try {
      const products = JSON.parse(await readFile(file, "utf-8"));
      const idx = products.findIndex((p) => p.id === productId && p.supplierId === check.supplier.id);
      if (idx === -1) continue;
      const { preserveSoldState } = await import("./product-availability.js");
      products[idx] = preserveSoldState(products[idx], {
        ...products[idx],
        publishedAt: Date.now(),
        refreshedAt: Date.now(),
      });
      await writeFile(file, JSON.stringify(products, null, 2) + "\n", "utf-8");
      updated = products[idx];
    } catch (err) {
      console.warn("[seller-onboard] refresh failed:", file, err.message);
    }
  }

  if (!updated) {
    return { error: "not_found", message: "Listing not found or not yours." };
  }

  // Push DB catalog rows up feed ranking (homepage / API feed use updated_at + refreshedAt).
  try {
    const { isDbEnabled, query } = await import("../db/pool.js");
    if (isDbEnabled()) {
      await query(
        `UPDATE products
            SET updated_at = NOW(),
                legacy_json = CASE
                  WHEN legacy_json IS NULL THEN jsonb_build_object('refreshedAt', $2::bigint, 'publishedAt', $2::bigint)
                  ELSE legacy_json
                       || jsonb_build_object('refreshedAt', $2::bigint)
                       || jsonb_build_object('publishedAt', $2::bigint)
                END
          WHERE id = $1`,
        [productId, Number(updated.refreshedAt)]
      );
    }
  } catch (err) {
    console.warn("[seller-onboard] DB bump skipped:", err.message);
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

/**
 * Drop (or raise) a live listing's seller-net price.
 * On a real drop of buyer all-in price, WhatsApp-notifies users who liked the item.
 */
export async function updateSellerListingPrice({ phone, productId, sellerNetKes, sessionToken }) {
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;

  const nextNet = Math.round(Number(sellerNetKes));
  if (!Number.isFinite(nextNet) || nextNet < 50) {
    return {
      error: "invalid_price",
      message: "Enter a valid price you receive (minimum KES 50).",
    };
  }

  const paths = [MASTER_CATALOG, REPO_CATALOG].filter((p) => existsSync(p));
  let updated = null;
  let oldBuyerTotal = null;
  let oldSellerNet = null;

  for (const file of paths) {
    try {
      const products = JSON.parse(await readFile(file, "utf-8"));
      const idx = products.findIndex((p) => p.id === productId && p.supplierId === check.supplier.id);
      if (idx === -1) continue;

      const current = products[idx];
      oldBuyerTotal =
        oldBuyerTotal ??
        (current.priceKes != null ? Math.round(Number(current.priceKes)) : null);
      oldSellerNet =
        oldSellerNet ??
        Math.round(Number(current.sellerNetKes ?? current.sourcePriceKes) || 0);

      const fees = computeFeeBreakdown(nextNet, current.shippingKes, {
        freeShipping: Boolean(current.freeShipping),
        deliveryMethod: current.deliveryMethod || "hub",
      });

      const { preserveSoldState, assertCanRestock } = await import("./product-availability.js");
      const gate = await assertCanRestock(productId, current);
      if (!gate.ok) {
        return {
          error: gate.error,
          message: gate.message || "Sold listings cannot be repriced onto the live grid.",
        };
      }
      products[idx] = preserveSoldState(current, {
        ...current,
        sellerNetKes: fees.sellerNetKes,
        sourcePriceKes: fees.sellerNetKes,
        priceKes: fees.buyerTotalKes,
        platformFeeKes: fees.platformFeeKes,
        transactionFeeKes: fees.transactionFeeKes,
        sellerPayoutKes: fees.sellerPayoutKes,
        shippingKes: fees.shippingKes,
        freeShipping: Boolean(fees.freeShipping),
        publishedAt: Date.now(),
        refreshedAt: Date.now(),
        priceUpdatedAt: Date.now(),
      });
      await writeFile(file, JSON.stringify(products, null, 2) + "\n", "utf-8");
      updated = products[idx];
    } catch (err) {
      console.warn("[seller-onboard] price update failed:", file, err.message);
    }
  }

  if (!updated) {
    return { error: "not_found", message: "Listing not found or not yours." };
  }

  const newBuyerTotal = Math.round(Number(updated.priceKes) || 0);

  try {
    const { isDbEnabled, query } = await import("../db/pool.js");
    const { upsertCatalogProduct } = await import("../db/repositories/products.js");
    if (isDbEnabled()) {
      await upsertCatalogProduct(updated);
      // Ensure ranking bump even if upsert path is partial.
      await query(
        `UPDATE products
            SET price_kes = $2,
                source_price_kes = $3,
                shipping_kes = $4,
                updated_at = NOW(),
                legacy_json = CASE
                  WHEN legacy_json IS NULL THEN jsonb_build_object(
                    'sellerNetKes', $3::int,
                    'priceKes', $2::int,
                    'refreshedAt', $5::bigint,
                    'priceUpdatedAt', $5::bigint
                  )
                  ELSE legacy_json
                       || jsonb_build_object('sellerNetKes', $3::int)
                       || jsonb_build_object('priceKes', $2::int)
                       || jsonb_build_object('refreshedAt', $5::bigint)
                       || jsonb_build_object('priceUpdatedAt', $5::bigint)
                END
          WHERE id = $1`,
        [
          productId,
          newBuyerTotal,
          Math.round(Number(updated.sellerNetKes) || nextNet),
          Math.round(Number(updated.shippingKes) || 0),
          Number(updated.priceUpdatedAt || Date.now()),
        ]
      );
    }
  } catch (err) {
    console.warn("[seller-onboard] DB price update skipped:", err.message);
  }

  try {
    const { execSync } = await import("node:child_process");
    execSync("node scripts/build-site-catalog.mjs", {
      cwd: path.join(__dirname, "..", "..", ".."),
      stdio: "pipe",
    });
  } catch {}

  let notified = 0;
  if (oldBuyerTotal != null && newBuyerTotal < oldBuyerTotal) {
    try {
      const { notifyLikersPriceDrop } = await import("./social-notifications.js");
      let excludeUserId = null;
      try {
        const { isDbEnabled, query } = await import("../db/pool.js");
        if (isDbEnabled()) {
          const { rows } = await query(
            `SELECT seller_user_id FROM products WHERE id = $1 LIMIT 1`,
            [productId]
          );
          if (rows[0]?.seller_user_id) excludeUserId = Number(rows[0].seller_user_id);
        }
      } catch {}
      const ping = await notifyLikersPriceDrop({
        productId,
        title: updated.name || productId,
        oldPriceKes: oldBuyerTotal,
        newPriceKes: newBuyerTotal,
        excludeUserId,
      });
      notified = Number(ping?.notified) || 0;
    } catch (err) {
      console.warn("[seller-onboard] price-drop notify skipped:", err.message);
    }
  }

  const drop = oldBuyerTotal != null && newBuyerTotal < oldBuyerTotal;
  const raise = oldBuyerTotal != null && newBuyerTotal > oldBuyerTotal;
  return {
    success: true,
    productId,
    sellerNetKes: Math.round(Number(updated.sellerNetKes) || nextNet),
    priceKes: newBuyerTotal,
    previousPriceKes: oldBuyerTotal,
    previousSellerNetKes: oldSellerNet,
    priceDropped: drop,
    priceRaised: raise,
    likersNotified: notified,
    refreshedAt: updated.refreshedAt,
    message: drop
      ? `Price dropped to buyer total KES ${newBuyerTotal.toLocaleString()} — you receive KES ${Math.round(Number(updated.sellerNetKes) || nextNet).toLocaleString()}.${notified ? ` Notified ${notified} liker${notified === 1 ? "" : "s"}.` : ""}`
      : raise
        ? `Price raised — buyer pays KES ${newBuyerTotal.toLocaleString()}, you receive KES ${Math.round(Number(updated.sellerNetKes) || nextNet).toLocaleString()}.`
        : `Price updated — buyer pays KES ${newBuyerTotal.toLocaleString()}, you receive KES ${Math.round(Number(updated.sellerNetKes) || nextNet).toLocaleString()}.`,
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
  await onOrderDelivered(getOrder(orderId) || order);

  const fresh = getOrder(orderId);
  const payout = await releaseEscrowPayout(orderId);

  return {
    success: true,
    order: fresh,
    payout,
    message: "Delivery confirmed — seller payout scheduled.",
  };
}

/**
 * After delivery — schedule escrow hold only.
 * B2C runs later via hourly cron (MPESA_B2C_AUTO) or admin `#payb2c SK-…`.
 */
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
  const netAmount = sellerOrderNet(order);

  const { updateOrderMeta } = await import("./orders.js");
  const { scheduleSellerPayoutAfterDelivery, addBusinessDays } = await import("./settlements.js");
  const { isB2CReady, b2cMeta } = await import("./daraja-mpesa.js");

  const eligibleAt = order.payoutEligibleAt || addBusinessDays(Date.now(), 3);
  scheduleSellerPayoutAfterDelivery({
    ...order,
    sourcePriceKes: netAmount,
    sellerNetKes: netAmount,
    payoutEligibleAt: eligibleAt,
  });
  updateOrderMeta(orderId, {
    payoutStatus: "scheduled",
    isPaidOut: false,
    payoutEligibleAt: eligibleAt,
  });

  return {
    success: true,
    scheduled: true,
    netAmount,
    mpesaPhone: mpesaPhone || null,
    b2c: b2cMeta(),
    message: isB2CReady()
      ? "Payout scheduled for escrow hold — B2C will send after hold (or use #payb2c)."
      : "Payout scheduled — configure B2C env vars or pay manually with #paid.",
  };
}
