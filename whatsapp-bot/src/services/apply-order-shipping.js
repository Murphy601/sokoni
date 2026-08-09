/**
 * Apply hybrid shipping calc onto an existing prepaid order, then Daraja STK
 * uses orderBuyerTotal() which already includes shippingKes.
 *
 * Safe default: sellers without a shipping profile keep existing order totals
 * (usually KES 0 shipping). Location fields are still saved for tracking/heatmaps.
 */

import { getOrder, updateOrderMeta } from "./orders.js";
import { calculateShipping } from "./calculate-shipping.js";
import { computeFeeBreakdown, orderBuyerTotal } from "./shipping-tiers.js";
import { mpesaTransactionFeeKes } from "./mpesa-transaction-fees.js";
import { inferCountyFromText } from "./kenya-locations.js";
import {
  findConfiguredVendorProfile,
  isConfiguredShippingProfile,
  normalizeVendorKey,
} from "./vendor-shipping.js";

const CART_PARENT_KIND = "cart_parent";

/**
 * @param {string} orderId
 * @param {{
 *   deliveryMethod?: 'MAP_PIN'|'COUNTY_DROPDOWN',
 *   buyerCoordinates?: { lat: number, lng: number },
 *   buyerCounty?: string,
 *   buyerTown?: string,
 *   isPickupStation?: boolean,
 *   landmarkNote?: string,
 *   deliveryType?: string,
 * }} location
 */
export async function applyShippingToOrder(orderId, location = {}) {
  const order = getOrder(orderId);
  if (!order) return { ok: false, error: "order_not_found" };
  if (order.customerPaymentStatus === "confirmed") {
    return { ok: false, error: "already_paid", message: "Cannot change shipping after payment." };
  }

  if (order.kind === CART_PARENT_KIND) {
    return applyShippingToCartParent(orderId, location);
  }

  const found = findConfiguredVendorProfile([
    order.shopHandle,
    order.supplierId,
    order.sellerId,
    order.sellerPhone,
  ]);
  const profile = found.profile;
  const configured = isConfiguredShippingProfile(profile);
  const vendorId =
    found.vendorKey ||
    normalizeVendorKey(order.shopHandle || order.supplierId || order.sellerId || "unknown");

  const calc = await calculateShipping({
    cartItems: [
      {
        productId: order.productId,
        vendorId,
        qty: order.quantity || 1,
      },
    ],
    deliveryMethod: location.deliveryMethod || "COUNTY_DROPDOWN",
    buyerCoordinates: location.buyerCoordinates,
    buyerCounty: location.buyerCounty,
    buyerTown: location.buyerTown,
    isPickupStation: location.isPickupStation,
  });

  if (!calc.ok && calc.error === "unsupported_route" && configured) {
    return {
      ok: false,
      error: calc.error,
      message: calc.message,
      calc,
    };
  }

  const line = calc.vendorBreakdown[0] || { shippingFee: 0, methodUsed: "NO_PROFILE" };
  const locationLine = [location.buyerCounty, location.buyerTown, location.landmarkNote]
    .filter(Boolean)
    .join(" · ");

  /** @type {Record<string, unknown>} */
  const patch = {
    buyerLat: location.buyerCoordinates?.lat ?? order.buyerLat ?? null,
    buyerLng: location.buyerCoordinates?.lng ?? order.buyerLng ?? null,
    deliveryCounty: location.buyerCounty || order.deliveryCounty || null,
    deliveryTown: location.buyerTown || order.deliveryTown || null,
    deliveryMethodCalc: calc.deliveryMethod,
    shippingCalcMeta: {
      methodUsed: line.methodUsed,
      totalShippingFee: calc.totalShippingFee,
      vendorBreakdown: calc.vendorBreakdown,
      isPickupStation: Boolean(location.isPickupStation),
      profilePresent: configured,
      moneyApplied: configured,
      at: new Date().toISOString(),
    },
  };

  if (locationLine && !order.location) patch.location = locationLine;
  if (location.deliveryType) patch.deliveryType = location.deliveryType;
  if (location.buyerTown) patch.landmarkTown = location.buyerTown;
  if (location.landmarkNote) patch.landmarkNote = String(location.landmarkNote).slice(0, 280);

  // Only rewrite money fields when the seller explicitly saved shipping rates.
  if (configured) {
    const shippingKes = Math.round(Number(line.shippingFee) || 0);
    const sellerNet = Math.round(
      Number(order.sellerNetKes ?? order.sourcePriceKes ?? order.priceKes) || 0
    );
    const fees = computeFeeBreakdown(Math.max(0, sellerNet), shippingKes, {
      freeShipping: shippingKes === 0,
      deliveryMethod: order.deliveryMethod || "seller_express",
    });
    Object.assign(patch, {
      shippingKes: fees.shippingKes,
      freeShipping: fees.freeShipping,
      platformFeeKes: fees.platformFeeKes,
      transactionFeeKes: fees.transactionFeeKes,
      sellerNetKes: fees.sellerNetKes,
      sellerPayoutKes: fees.sellerPayoutKes,
      // priceKes = item (seller-net); totalKes = buyer all-in for STK / orderBuyerTotal
      priceKes: fees.itemKes,
      totalKes: fees.buyerTotalKes,
    });
  }

  updateOrderMeta(orderId, patch);
  const updated = getOrder(orderId);
  return {
    ok: true,
    orderId,
    shippingKes: Math.round(Number(updated.shippingKes) || 0),
    totalKes: orderBuyerTotal(updated),
    profilePresent: configured,
    calc,
    order: {
      orderId: updated.id,
      amountKes: orderBuyerTotal(updated),
      shippingKes: updated.shippingKes,
      deliveryCounty: updated.deliveryCounty,
      deliveryTown: updated.deliveryTown,
      buyerLat: updated.buyerLat,
      buyerLng: updated.buyerLng,
    },
  };
}

async function applyShippingToCartParent(orderId, location = {}) {
  const parent = getOrder(orderId);
  if (!parent) return { ok: false, error: "order_not_found" };
  const childIds = Array.isArray(parent.itemIds) ? parent.itemIds : [];
  const children = childIds.map((id) => getOrder(id)).filter(Boolean);
  if (!children.length) return { ok: false, error: "empty_cart" };

  const cartItems = children.map((c) => {
    const found = findConfiguredVendorProfile([c.shopHandle, c.supplierId, c.sellerId, c.sellerPhone]);
    return {
      productId: c.productId,
      vendorId:
        found.vendorKey ||
        normalizeVendorKey(c.shopHandle || c.supplierId || c.sellerId || "unknown"),
      qty: c.quantity || 1,
    };
  });

  const calc = await calculateShipping({
    cartItems,
    deliveryMethod: location.deliveryMethod || "COUNTY_DROPDOWN",
    buyerCoordinates: location.buyerCoordinates,
    buyerCounty: location.buyerCounty,
    buyerTown: location.buyerTown,
    isPickupStation: location.isPickupStation,
  });

  if (!calc.ok && calc.error === "unsupported_route") {
    return { ok: false, error: calc.error, message: calc.message, calc };
  }

  const feeByVendor = new Map(
    (calc.vendorBreakdown || []).map((v) => [normalizeVendorKey(v.vendorId), v])
  );

  let shipSum = 0;
  let itemSum = 0;
  let platformSum = 0;
  let sellerNetSum = 0;
  let sellerPayoutSum = 0;
  let anyProfile = false;

  for (const child of children) {
    const found = findConfiguredVendorProfile([
      child.shopHandle,
      child.supplierId,
      child.sellerId,
      child.sellerPhone,
    ]);
    const vendorId =
      found.vendorKey ||
      normalizeVendorKey(child.shopHandle || child.supplierId || child.sellerId || "unknown");
    const configured = isConfiguredShippingProfile(found.profile);
    const line = feeByVendor.get(vendorId) || { shippingFee: 0, methodUsed: "NO_PROFILE" };
    /** @type {Record<string, unknown>} */
    const childPatch = {
      deliveryCounty: location.buyerCounty || child.deliveryCounty || null,
      deliveryTown: location.buyerTown || child.deliveryTown || null,
      shippingCalcMeta: {
        methodUsed: line.methodUsed,
        shippingFee: line.shippingFee,
        profilePresent: configured,
        moneyApplied: configured,
        at: new Date().toISOString(),
      },
    };
    if (configured) {
      anyProfile = true;
      const shippingKes = Math.round(Number(line.shippingFee) || 0);
      const sellerNet = Math.round(
        Number(child.sellerNetKes ?? child.sourcePriceKes ?? child.priceKes) || 0
      );
      const fees = computeFeeBreakdown(Math.max(0, sellerNet), shippingKes, {
        freeShipping: shippingKes === 0,
        deliveryMethod: child.deliveryMethod || "seller_express",
      });
      Object.assign(childPatch, {
        shippingKes: fees.shippingKes,
        freeShipping: fees.freeShipping,
        platformFeeKes: fees.platformFeeKes,
        transactionFeeKes: 0,
        sellerNetKes: fees.sellerNetKes,
        sellerPayoutKes: fees.sellerPayoutKes,
        priceKes: fees.itemKes,
        totalKes: fees.sellerNetKes + fees.shippingKes + fees.platformFeeKes,
      });
      shipSum += fees.shippingKes;
      itemSum += fees.itemKes;
      platformSum += fees.platformFeeKes;
      sellerNetSum += fees.sellerNetKes;
      sellerPayoutSum += fees.sellerPayoutKes;
    } else {
      shipSum += Math.round(Number(child.shippingKes) || 0);
      itemSum += Math.round(Number(child.priceKes) || 0);
      platformSum += Math.round(Number(child.platformFeeKes) || 0);
      sellerNetSum += Math.round(Number(child.sellerNetKes) || 0);
      sellerPayoutSum += Math.round(Number(child.sellerPayoutKes) || 0);
    }
    updateOrderMeta(child.id, childPatch);
  }

  const chargeBeforeTxn = itemSum + shipSum + platformSum;
  // Parent keeps a single M-Pesa txn fee (same as cart create).
  const txnFee = mpesaTransactionFeeKes(chargeBeforeTxn);
  const totalKes = chargeBeforeTxn + txnFee;

  updateOrderMeta(orderId, {
    deliveryCounty: location.buyerCounty || parent.deliveryCounty || null,
    deliveryTown: location.buyerTown || parent.deliveryTown || null,
    shippingKes: shipSum,
    priceKes: itemSum,
    platformFeeKes: platformSum,
    sellerNetKes: sellerNetSum,
    sellerPayoutKes: sellerPayoutSum,
    transactionFeeKes: txnFee,
    chargeBeforeTxnKes: chargeBeforeTxn,
    totalKes,
    shippingCalcMeta: {
      methodUsed: "CART_HYBRID",
      totalShippingFee: calc.totalShippingFee,
      vendorBreakdown: calc.vendorBreakdown,
      profilePresent: anyProfile,
      at: new Date().toISOString(),
    },
  });

  const updated = getOrder(orderId);
  return {
    ok: true,
    orderId,
    shippingKes: Math.round(Number(updated.shippingKes) || 0),
    totalKes: orderBuyerTotal(updated),
    profilePresent: anyProfile,
    calc,
    order: {
      orderId: updated.id,
      amountKes: orderBuyerTotal(updated),
      shippingKes: updated.shippingKes,
      deliveryCounty: updated.deliveryCounty,
      deliveryTown: updated.deliveryTown,
    },
  };
}

/**
 * Before Daraja STK / cashout: if the seller has a shipping profile, resolve
 * county from the order location and rewrite shippingKes + totalKes.
 * No-op when no profile (keeps seller-handled KES 0 behaviour).
 */
export async function ensureHybridShippingBeforePayment(orderIn) {
  const order = orderIn?.id ? getOrder(orderIn.id) || orderIn : orderIn;
  if (!order?.id) return { ok: true, order: orderIn, applied: false };
  if (order.customerPaymentStatus === "confirmed") {
    return { ok: true, order, applied: false };
  }
  if (order.shippingCalcMeta?.at && order.shippingCalcMeta?.moneyApplied) {
    return { ok: true, order, applied: false };
  }

  const inferred = inferCountyFromText(
    [order.deliveryCounty, order.deliveryTown, order.location, order.landmarkTown]
      .filter(Boolean)
      .join(" · ")
  );
  const buyerCounty = order.deliveryCounty || inferred?.county || null;
  const buyerTown = order.deliveryTown || inferred?.town || null;

  const vendors = [];
  if (order.kind === CART_PARENT_KIND) {
    for (const id of order.itemIds || []) {
      const child = getOrder(id);
      if (!child) continue;
      const found = findConfiguredVendorProfile([
        child.shopHandle,
        child.supplierId,
        child.sellerId,
        child.sellerPhone,
      ]);
      if (found.vendorKey && found.profile) vendors.push(found.vendorKey);
    }
  } else {
    const found = findConfiguredVendorProfile([
      order.shopHandle,
      order.supplierId,
      order.sellerId,
      order.sellerPhone,
    ]);
    if (found.vendorKey && found.profile) vendors.push(found.vendorKey);
  }

  if (!vendors.length) {
    return { ok: true, order, applied: false, reason: "no_profile" };
  }

  if (!buyerCounty && !(order.buyerLat != null && order.buyerLng != null)) {
    // Cannot price without a county — leave totals, but don't block STK.
    console.warn(
      `[shipping] order ${order.id}: seller has rates but county not found in "${order.location}"`
    );
    return { ok: true, order, applied: false, reason: "county_unknown" };
  }

  const result = await applyShippingToOrder(order.id, {
    deliveryMethod:
      order.buyerLat != null && order.buyerLng != null ? "MAP_PIN" : "COUNTY_DROPDOWN",
    buyerCoordinates:
      order.buyerLat != null && order.buyerLng != null
        ? { lat: Number(order.buyerLat), lng: Number(order.buyerLng) }
        : undefined,
    buyerCounty: buyerCounty || undefined,
    buyerTown: buyerTown || undefined,
  });

  if (!result.ok) {
    console.warn(`[shipping] apply failed for ${order.id}:`, result.error, result.message);
    return { ok: true, order: getOrder(order.id) || order, applied: false, result };
  }

  return { ok: true, order: getOrder(order.id), applied: true, result };
}
