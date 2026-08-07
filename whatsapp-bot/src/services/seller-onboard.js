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
import { healReleasedSellerPayouts } from "./settlements.js";

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

/**
 * Seller-facing fulfillment phase for hub UI.
 * Aligns with buyer YES / auto-release / #status delivered — not just shipmentStatus alone.
 */
export function sellerOrderFulfillment(order) {
  const paid =
    order?.customerPaymentStatus === "confirmed" ||
    order?.escrowStatus === "held" ||
    order?.escrowStatus === "released";
  const shipmentStatus = order?.shipmentStatus || "pending";
  const status = String(order?.status || "").toLowerCase();
  const escrow = String(order?.escrowStatus || "").toLowerCase();

  const received = Boolean(
    status === "delivered" ||
      shipmentStatus === "delivered" ||
      order?.buyerConfirmedAt ||
      order?.shipmentDeliveredAt ||
      order?.deliveredAt ||
      escrow === "released"
  );

  const dispatched = Boolean(
    received ||
      order?.sellerDispatchedAt ||
      order?.inTransitAt ||
      ["dropped_off", "in_transit", "at_pickup_point", "delivered"].includes(shipmentStatus) ||
      ["out_for_delivery", "delivered"].includes(status)
  );

  /** Paid, not yet handed off — show Print label. */
  const needsDropOff =
    paid &&
    !received &&
    !dispatched &&
    ["pending", "label_ready"].includes(shipmentStatus);

  let phase = "unpaid";
  if (paid && received) phase = "received";
  else if (paid && dispatched) phase = "shipped";
  else if (paid) phase = "awaiting_ship";

  const phaseLabel =
    phase === "received"
      ? "Received"
      : phase === "shipped"
        ? "Shipped"
        : phase === "awaiting_ship"
          ? needsDropOff
            ? "Awaiting ship"
            : shipmentStatusLabel(shipmentStatus)
          : "Unpaid";

  return {
    paid: Boolean(paid && order?.customerPaymentStatus === "confirmed"),
    shipmentStatus,
    shipmentStatusLabel:
      phase === "received"
        ? "Received"
        : phase === "shipped"
          ? "Shipped"
          : shipmentStatusLabel(shipmentStatus),
    status: order?.status || null,
    needsDropOff,
    received,
    dispatched,
    phase,
    phaseLabel,
    buyerConfirmedAt: order?.buyerConfirmedAt || null,
    sellerDispatchedAt: order?.sellerDispatchedAt || null,
    deliveredAt: order?.deliveredAt || order?.shipmentDeliveredAt || null,
  };
}

function orderBuyerPhone(order) {
  const direct = normalizePhone(order?.phone || order?.mpesaPhone || "");
  if (direct) return direct;
  // WhatsApp chat ids are often 2547…@c.us / @s.whatsapp.net
  const fromKey = normalizePhone(String(order?.customerKey || order?.chatId || "").split("@")[0] || "");
  if (fromKey && fromKey.length >= 10) return fromKey;
  return null;
}

/** Seller dashboard — paid orders, labels, shipment status (Phases 5–6). */
export function getSellerOrders(supplierId) {
  return loadAllOrders()
    .filter(
      (o) =>
        o.supplierId === supplierId &&
        o.status !== "cancelled" &&
        o.kind !== "cart_parent"
    )
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((o) => {
      const fulfill = sellerOrderFulfillment(o);
      const paid = fulfill.paid;

      return {
        orderId: o.id,
        productId: o.productId || null,
        productName: o.productName,
        quantity: Math.max(1, Math.round(Number(o.quantity) || 1)),
        sellerNetKes: sellerOrderNet(o),
        paid,
        status: fulfill.status,
        shipmentStatus: fulfill.shipmentStatus,
        shipmentStatusLabel: fulfill.shipmentStatusLabel,
        needsDropOff: fulfill.needsDropOff,
        received: fulfill.received,
        dispatched: fulfill.dispatched,
        phase: fulfill.phase,
        phaseLabel: fulfill.phaseLabel,
        buyerConfirmedAt: fulfill.buyerConfirmedAt,
        sellerDispatchedAt: fulfill.sellerDispatchedAt,
        deliveredAt: fulfill.deliveredAt,
        customerName: o.customerName || null,
        buyerPhone: orderBuyerPhone(o),
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
  // Move any already-released orders into Ready for M-Pesa (fixes pre-fix Releases).
  try {
    healReleasedSellerPayouts(supplierId);
  } catch (err) {
    console.warn("[seller-onboard] payout heal skipped:", err?.message || err);
  }

  const settlements = loadSettlements();
  const orders = loadAllOrders().filter((o) => o.supplierId === supplierId);

  const sellerEntries = settlements.entries.filter((e) => e.supplierId === supplierId);

  // Ready for M-Pesa = owed (withdrawable) + failed B2C (retry). Never pending escrow.
  const available = sellerEntries
    .filter((e) => e.status === "owed" || e.status === "b2c_failed" || e.status === "paid")
    .map((e) => ({
      orderId: e.orderId,
      amountKes: e.payoutAmountKes,
      status: e.status === "paid" ? "paid" : e.status === "b2c_failed" ? "b2c_failed" : "available",
      productName: e.productName,
      readyLabel:
        e.status === "paid"
          ? "Paid out"
          : e.status === "b2c_failed"
            ? "Ready — retry withdraw"
            : "Ready for M-Pesa",
    }));

  // Sending to M-Pesa — show under Ready list as in-flight, but not withdrawable again.
  const sending = sellerEntries
    .filter((e) => e.status === "disbursing")
    .map((e) => ({
      orderId: e.orderId,
      amountKes: e.payoutAmountKes,
      status: "disbursing",
      productName: e.productName,
      readyLabel: "Sending to M-Pesa",
    }));

  // Pending escrow = buyer paid, still held. Released money must NEVER land here.
  const pendingEscrow = orders
    .filter(
      (o) =>
        o.customerPaymentStatus === "confirmed" &&
        String(o.escrowStatus || "").toLowerCase() === "held" &&
        !o.escrowReleasedAt &&
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

  const readyItems = available.filter((e) => e.status === "available" || e.status === "b2c_failed");
  const availableTotal = readyItems.reduce((s, e) => s + (e.amountKes || 0), 0);
  const paidOutItems = available.filter((e) => e.status === "paid");
  const paidOutTotal = paidOutItems.reduce((s, e) => s + (e.amountKes || 0), 0);
  const pendingTotal = pendingEscrow.reduce((s, e) => s + (e.amountKes || 0), 0);
  const transitTotal = inTransit.reduce((s, e) => s + (e.amountKes || 0), 0);

  return {
    available: { totalKes: availableTotal, items: [...readyItems, ...sending] },
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

function resolvePromoSellerNet(listNet, type, value) {
  const list = Math.round(Number(listNet) || 0);
  const v = Number(value);
  if (!Number.isFinite(list) || list < 50) return { error: "invalid_list_price" };
  if (!Number.isFinite(v) || v <= 0) return { error: "invalid_promo_value" };
  let next = list;
  const t = String(type || "percent").toLowerCase();
  if (t === "percent" || t === "pct" || t === "%") {
    if (v > 70) return { error: "promo_too_steep", message: "Max promo is 70% off." };
    next = Math.round(list * (1 - v / 100));
  } else if (t === "kes_off" || t === "off" || t === "kes") {
    if (v >= list) return { error: "promo_too_steep", message: "KES off must be less than your list price." };
    next = Math.round(list - v);
  } else if (t === "sale_net" || t === "sale" || t === "net") {
    next = Math.round(v);
  } else {
    return { error: "invalid_promo_type", message: "Use percent, kes_off, or sale_net." };
  }
  if (next < 50) return { error: "invalid_promo_value", message: "Promo seller net must stay at least KES 50." };
  if (next >= list) {
    return { error: "promo_not_lower", message: "Promo must be lower than your current list price." };
  }
  return { nextNet: next, type: t === "pct" || t === "%" ? "percent" : t === "off" || t === "kes" ? "kes_off" : t === "sale" || t === "net" ? "sale_net" : t };
}

/**
 * Start an item promo. Lowers seller net → recomputes fees → buyer STK uses new priceKes.
 * Only this product is discounted — no cart-wide codes.
 */
export async function setSellerListingPromo({
  phone,
  productId,
  type = "percent",
  value,
  sessionToken,
}) {
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;

  const paths = [MASTER_CATALOG, REPO_CATALOG].filter((p) => existsSync(p));
  let updated = null;
  let listSellerNet = null;
  let listBuyerTotal = null;

  for (const file of paths) {
    try {
      const products = JSON.parse(await readFile(file, "utf-8"));
      const idx = products.findIndex((p) => p.id === productId && p.supplierId === check.supplier.id);
      if (idx === -1) continue;

      const current = products[idx];
      const existingPromo = current.promo && typeof current.promo === "object" ? current.promo : null;
      listSellerNet =
        listSellerNet ??
        Math.round(
          Number(
            existingPromo?.active && existingPromo?.listSellerNetKes
              ? existingPromo.listSellerNetKes
              : current.sellerNetKes ?? current.sourcePriceKes
          ) || 0
        );
      listBuyerTotal =
        listBuyerTotal ??
        Math.round(
          Number(
            existingPromo?.active && existingPromo?.listPriceKes
              ? existingPromo.listPriceKes
              : current.priceKes
          ) || 0
        );

      const resolved = resolvePromoSellerNet(listSellerNet, type, value);
      if (resolved.error) return resolved;

      const fees = computeFeeBreakdown(resolved.nextNet, current.shippingKes, {
        freeShipping: Boolean(current.freeShipping),
        deliveryMethod: current.deliveryMethod || "hub",
      });

      const { preserveSoldState, assertCanRestock } = await import("./product-availability.js");
      const gate = await assertCanRestock(productId, current);
      if (!gate.ok) {
        return {
          error: gate.error,
          message: gate.message || "Sold listings cannot take a promo.",
        };
      }

      const promo = {
        active: true,
        type: resolved.type,
        value: Number(value),
        listSellerNetKes: listSellerNet,
        listPriceKes: listBuyerTotal || fees.buyerTotalKes,
        startedAt: Date.now(),
        endedAt: null,
      };

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
        originalPriceKes: promo.listPriceKes,
        promo,
        publishedAt: Date.now(),
        refreshedAt: Date.now(),
        priceUpdatedAt: Date.now(),
        promoUpdatedAt: Date.now(),
      });
      await writeFile(file, JSON.stringify(products, null, 2) + "\n", "utf-8");
      updated = products[idx];
    } catch (err) {
      console.warn("[seller-onboard] promo set failed:", file, err.message);
    }
  }

  if (!updated) {
    return { error: "not_found", message: "Listing not found or not yours." };
  }

  await syncListingPriceToDb(updated);
  try {
    const { execSync } = await import("node:child_process");
    execSync("node scripts/build-site-catalog.mjs", {
      cwd: path.join(__dirname, "..", "..", ".."),
      stdio: "pipe",
    });
  } catch {}

  const buyerPays = Math.round(Number(updated.priceKes) || 0);
  const youGet = Math.round(Number(updated.sellerNetKes) || 0);
  return {
    success: true,
    productId,
    promo: updated.promo,
    sellerNetKes: youGet,
    priceKes: buyerPays,
    originalPriceKes: updated.originalPriceKes,
    message: `Promo live — buyers pay KES ${buyerPays.toLocaleString()} (was KES ${Math.round(Number(updated.originalPriceKes) || 0).toLocaleString()}). You receive KES ${youGet.toLocaleString()}. STK uses this price. End anytime from My listings.`,
  };
}

/** End item promo and restore list seller net / buyer price. */
export async function endSellerListingPromo({ phone, productId, sessionToken }) {
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;

  const paths = [MASTER_CATALOG, REPO_CATALOG].filter((p) => existsSync(p));
  let updated = null;

  for (const file of paths) {
    try {
      const products = JSON.parse(await readFile(file, "utf-8"));
      const idx = products.findIndex((p) => p.id === productId && p.supplierId === check.supplier.id);
      if (idx === -1) continue;

      const current = products[idx];
      const existingPromo = current.promo && typeof current.promo === "object" ? current.promo : null;
      if (!existingPromo?.active) {
        return { error: "no_active_promo", message: "This listing has no active promo." };
      }

      const restoreNet = Math.round(
        Number(existingPromo.listSellerNetKes ?? current.sellerNetKes ?? current.sourcePriceKes) || 0
      );
      if (restoreNet < 50) {
        return { error: "invalid_list_price", message: "Could not restore list price — set price manually." };
      }

      const fees = computeFeeBreakdown(restoreNet, current.shippingKes, {
        freeShipping: Boolean(current.freeShipping),
        deliveryMethod: current.deliveryMethod || "hub",
      });

      const { preserveSoldState, assertCanRestock } = await import("./product-availability.js");
      const gate = await assertCanRestock(productId, current);
      if (!gate.ok) {
        return {
          error: gate.error,
          message: gate.message || "Sold listings cannot end a promo onto the live grid.",
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
        originalPriceKes: undefined,
        promo: {
          ...existingPromo,
          active: false,
          endedAt: Date.now(),
        },
        publishedAt: Date.now(),
        refreshedAt: Date.now(),
        priceUpdatedAt: Date.now(),
        promoUpdatedAt: Date.now(),
      });
      // Drop undefined originalPriceKes from JSON
      delete products[idx].originalPriceKes;
      await writeFile(file, JSON.stringify(products, null, 2) + "\n", "utf-8");
      updated = products[idx];
    } catch (err) {
      console.warn("[seller-onboard] promo end failed:", file, err.message);
    }
  }

  if (!updated) {
    return { error: "not_found", message: "Listing not found or not yours." };
  }

  await syncListingPriceToDb(updated);
  try {
    const { execSync } = await import("node:child_process");
    execSync("node scripts/build-site-catalog.mjs", {
      cwd: path.join(__dirname, "..", "..", ".."),
      stdio: "pipe",
    });
  } catch {}

  const buyerPays = Math.round(Number(updated.priceKes) || 0);
  const youGet = Math.round(Number(updated.sellerNetKes) || 0);
  return {
    success: true,
    productId,
    promo: updated.promo,
    sellerNetKes: youGet,
    priceKes: buyerPays,
    originalPriceKes: null,
    message: `Promo ended — list price restored. Buyers pay KES ${buyerPays.toLocaleString()}, you receive KES ${youGet.toLocaleString()}.`,
  };
}

async function syncListingPriceToDb(updated) {
  if (!updated?.id) return;
  try {
    const { isDbEnabled, query } = await import("../db/pool.js");
    const { upsertCatalogProduct } = await import("../db/repositories/products.js");
    if (!isDbEnabled()) return;
    await upsertCatalogProduct(updated);
    const promo = updated.promo && typeof updated.promo === "object" ? updated.promo : null;
    await query(
      `UPDATE products
          SET price_kes = $2,
              source_price_kes = $3,
              shipping_kes = $4,
              original_price_kes = $5,
              updated_at = NOW(),
              legacy_json = CASE
                WHEN legacy_json IS NULL THEN $6::jsonb
                ELSE legacy_json || $6::jsonb
              END
        WHERE id = $1`,
      [
        updated.id,
        Math.round(Number(updated.priceKes) || 0),
        Math.round(Number(updated.sellerNetKes) || 0),
        Math.round(Number(updated.shippingKes) || 0),
        updated.originalPriceKes != null ? Math.round(Number(updated.originalPriceKes)) : null,
        JSON.stringify({
          sellerNetKes: Math.round(Number(updated.sellerNetKes) || 0),
          priceKes: Math.round(Number(updated.priceKes) || 0),
          platformFeeKes: Math.round(Number(updated.platformFeeKes) || 0),
          transactionFeeKes: Math.round(Number(updated.transactionFeeKes) || 0),
          originalPriceKes: updated.originalPriceKes != null ? Math.round(Number(updated.originalPriceKes)) : null,
          promo: promo,
          refreshedAt: Number(updated.refreshedAt || Date.now()),
          priceUpdatedAt: Number(updated.priceUpdatedAt || Date.now()),
          promoUpdatedAt: Number(updated.promoUpdatedAt || Date.now()),
        }),
      ]
    );
  } catch (err) {
    console.warn("[seller-onboard] DB promo sync skipped:", err.message);
  }
}

/**
 * Update live listing units on hand (multi-unit inventory).
 * Soft out-of-stock items can be restocked; permanent sold tombstones cannot.
 */
export async function updateSellerListingStock({ phone, productId, stockQuantity, sessionToken }) {
  const check = await requireAuthenticatedSeller(phone, sessionToken);
  if (check.error) return check;

  const qty = Math.round(Number(stockQuantity));
  if (!Number.isFinite(qty) || qty < 0 || qty > 9999) {
    return {
      error: "invalid_stock",
      message: "Enter units on hand between 0 and 9999.",
    };
  }
  if (!productId) {
    return { error: "missing_product_id", message: "Missing product id." };
  }

  const paths = [MASTER_CATALOG, REPO_CATALOG].filter((p) => existsSync(p));
  let updated = null;
  const sellerDigits = normalizePhone(phone);

  for (const file of paths) {
    try {
      const products = JSON.parse(await readFile(file, "utf-8"));
      const idx = products.findIndex((p) => {
        if (p.id !== productId) return false;
        if (p.supplierId && p.supplierId === check.supplier.id) return true;
        if (sellerDigits && normalizePhone(p.sellerPhone) === sellerDigits) return true;
        return false;
      });
      if (idx === -1) continue;

      const current = products[idx];
      const { applyStockQuantityFields, clearSoldSku } = await import("./product-availability.js");

      // Seller-owned inventory update wins: clear permanent tombstone so multi-unit restock works
      // after older builds wrongly sold-locked every payment.
      if (qty > 0) {
        await clearSoldSku(productId);
      }

      const next = applyStockQuantityFields({ ...current }, qty);
      next.stockUpdatedAt = Date.now();
      products[idx] = next;
      await writeFile(file, JSON.stringify(products, null, 2) + "\n", "utf-8");
      updated = next;
    } catch (err) {
      console.warn("[seller-onboard] stock update failed:", file, err.message);
    }
  }

  if (!updated) {
    return { error: "not_found", message: "Listing not found or not yours." };
  }

  try {
    const { isDbEnabled } = await import("../db/pool.js");
    const { updateProductInventory, upsertCatalogProduct } = await import(
      "../db/repositories/products.js"
    );
    if (isDbEnabled()) {
      await upsertCatalogProduct(updated);
      await updateProductInventory(productId, {
        stockQuantity: updated.stockQuantity,
        inStock: updated.inStock !== false && !updated.isSold,
        isSold: Boolean(updated.isSold),
      });
    }
  } catch (err) {
    console.warn("[seller-onboard] DB stock update skipped:", err.message);
  }

  try {
    const { invalidateProductCache } = await import("./catalog.js");
    invalidateProductCache();
  } catch {}

  try {
    const { syncPublicCatalog } = await import("./catalog-ops.js");
    await syncPublicCatalog();
  } catch (err) {
    console.warn("[seller-onboard] catalog sync after stock:", err.message);
  }

  return {
    success: true,
    productId,
    stockQuantity: Math.max(0, Math.round(Number(updated.stockQuantity) || 0)),
    inStock: updated.inStock !== false && !updated.isSold,
    isSold: Boolean(updated.isSold),
    message:
      qty > 0
        ? `Units on hand set to ${qty} — listing stays on the main menu while stock remains.`
        : "Marked out of stock — buyers won't see it until you add units again.",
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
  const { creditSellerWalletAfterDelivery, escrowHoldBusinessDays } = await import(
    "./settlements.js"
  );
  const { isB2CReady, b2cMeta } = await import("./daraja-mpesa.js");

  const holdDays = escrowHoldBusinessDays();
  const ready = creditSellerWalletAfterDelivery(
    {
      ...order,
      sourcePriceKes: netAmount,
      sellerNetKes: netAmount,
    },
    { payoutAmountKes: netAmount }
  );
  const immediate = holdDays === 0 || ready?.status === "owed";
  updateOrderMeta(orderId, {
    payoutStatus: immediate ? "owed" : "scheduled",
    isPaidOut: false,
    payoutEligibleAt: ready?.payoutEligibleAt || Date.now(),
    escrowStatus: "released",
  });

  return {
    success: true,
    scheduled: !immediate,
    ready: immediate,
    netAmount,
    mpesaPhone: mpesaPhone || null,
    b2c: b2cMeta(),
    message: immediate
      ? isB2CReady()
        ? "Seller wallet credited (Ready for M-Pesa). Withdraw sends B2C instantly."
        : "Seller wallet credited (Ready for M-Pesa). Configure B2C for instant withdraw, or #paid after manual send."
      : isB2CReady()
        ? `Payout scheduled (${holdDays} business day hold) — then Ready / #payb2c.`
        : `Payout scheduled (${holdDays} business day hold).`,
  };
}
