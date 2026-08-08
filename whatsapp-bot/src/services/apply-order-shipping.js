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
import { getVendorShippingProfile, normalizeVendorKey } from "./vendor-shipping.js";

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

  const vendorId = normalizeVendorKey(
    order.shopHandle || order.supplierId || order.sellerId || "unknown"
  );
  const profile = getVendorShippingProfile(vendorId);

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

  if (!calc.ok && calc.error === "unsupported_route") {
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
      profilePresent: Boolean(profile),
      at: new Date().toISOString(),
    },
  };

  if (locationLine) patch.location = locationLine;
  if (location.deliveryType) patch.deliveryType = location.deliveryType;
  if (location.buyerTown) patch.landmarkTown = location.buyerTown;
  if (location.landmarkNote) patch.landmarkNote = String(location.landmarkNote).slice(0, 280);

  // Only rewrite money fields when the seller configured a shipping profile.
  if (profile) {
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
      priceKes: fees.buyerTotalKes,
    });
  }

  updateOrderMeta(orderId, patch);
  const updated = getOrder(orderId);
  return {
    ok: true,
    orderId,
    shippingKes: Math.round(Number(updated.shippingKes) || 0),
    totalKes: orderBuyerTotal(updated),
    profilePresent: Boolean(profile),
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
