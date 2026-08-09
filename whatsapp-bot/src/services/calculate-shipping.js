/**
 * Hybrid shipping fee engine — county tiers + optional map-pin zones.
 * Uses Turf when installed; falls back to built-in point-in-polygon.
 */

import {
  getVendorShippingProfile,
  isConfiguredShippingProfile,
  listVendorZones,
  normalizeVendorKey,
  pointInPolygon,
  resolveVendorShippingFee,
} from "./vendor-shipping.js";

async function loadTurf() {
  try {
    const mod = await import("@turf/boolean-point-in-polygon");
    const helpers = await import("@turf/helpers");
    return {
      booleanPointInPolygon: mod.default || mod.booleanPointInPolygon,
      point: helpers.point,
      polygon: helpers.polygon,
    };
  } catch {
    return null;
  }
}

function pinInZoneSync(lng, lat, boundary, turf) {
  if (turf?.booleanPointInPolygon && turf.point && turf.polygon) {
    try {
      return Boolean(
        turf.booleanPointInPolygon(turf.point([lng, lat]), turf.polygon(boundary.coordinates))
      );
    } catch {
      /* fall through */
    }
  }
  return pointInPolygon(lng, lat, boundary);
}

/**
 * @param {{
 *   cartItems: Array<{ productId?: string, vendorId?: string, qty?: number }>,
 *   deliveryMethod?: 'MAP_PIN'|'COUNTY_DROPDOWN',
 *   buyerCoordinates?: { lat: number, lng: number },
 *   buyerCounty?: string,
 *   buyerTown?: string,
 *   isPickupStation?: boolean,
 * }} body
 */
export async function calculateShipping(body = {}) {
  const items = Array.isArray(body.cartItems) ? body.cartItems : [];
  const deliveryMethod =
    String(body.deliveryMethod || "COUNTY_DROPDOWN").toUpperCase() === "MAP_PIN"
      ? "MAP_PIN"
      : "COUNTY_DROPDOWN";
  const buyerCoordinates =
    body.buyerCoordinates &&
    Number.isFinite(Number(body.buyerCoordinates.lat)) &&
    Number.isFinite(Number(body.buyerCoordinates.lng))
      ? {
          lat: Number(body.buyerCoordinates.lat),
          lng: Number(body.buyerCoordinates.lng),
        }
      : null;
  const buyerCounty = String(body.buyerCounty || "").trim();
  const buyerTown = String(body.buyerTown || "").trim();
  const isPickupStation = Boolean(body.isPickupStation);
  const turf = deliveryMethod === "MAP_PIN" ? await loadTurf() : null;

  if (!items.length) {
    return {
      ok: false,
      error: "empty_cart",
      message: "cartItems required",
      vendorBreakdown: [],
      totalShippingFee: 0,
    };
  }

  /** @type {Map<string, { vendorId: string, productIds: string[] }>} */
  const byVendor = new Map();
  for (const item of items) {
    const vendorId = normalizeVendorKey(item.vendorId || item.sellerId || item.shopHandle || "unknown");
    if (!byVendor.has(vendorId)) {
      byVendor.set(vendorId, { vendorId, productIds: [] });
    }
    if (item.productId) byVendor.get(vendorId).productIds.push(String(item.productId));
  }

  const vendorBreakdown = [];
  let totalShippingFee = 0;
  let anyUnsupported = false;

  for (const { vendorId, productIds } of byVendor.values()) {
    const rawProfile = getVendorShippingProfile(vendorId);
    const profile = isConfiguredShippingProfile(rawProfile) ? rawProfile : null;
    const zones = listVendorZones(vendorId);

    if (deliveryMethod === "MAP_PIN" && buyerCoordinates && profile) {
      const turfHit = zones.find(
        (z) =>
          z.isActive !== false &&
          pinInZoneSync(buyerCoordinates.lng, buyerCoordinates.lat, z.boundary, turf)
      );
      if (turfHit) {
        const fee = Math.round(Number(turfHit.priceKes) || 0);
        const pickupDiscount = isPickupStation ? Math.min(150, fee) : 0;
        const shippingFee = Math.max(0, fee - pickupDiscount);
        totalShippingFee += shippingFee;
        vendorBreakdown.push({
          vendorId,
          productIds,
          shippingFee,
          methodUsed: `ZONE_POLYGON_${String(turfHit.zoneName || "ZONE")
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "_")
            .slice(0, 40)}`,
          zoneId: turfHit.id,
          zoneName: turfHit.zoneName,
          estimatedHours: 4,
          unsupported: false,
          engine: turf ? "turf" : "builtin",
        });
        continue;
      }
    }

    const resolved = resolveVendorShippingFee({
      vendorKey: vendorId,
      deliveryMethod,
      buyerCounty,
      buyerTown,
      buyerCoordinates,
      profile,
      zones,
    });

    let shippingFee = Math.round(Number(resolved.shippingFee) || 0);
    if (isPickupStation && shippingFee > 0) {
      shippingFee = Math.max(0, shippingFee - 150);
    }
    if (resolved.unsupported) anyUnsupported = true;
    totalShippingFee += shippingFee;
    vendorBreakdown.push({
      vendorId,
      productIds,
      shippingFee,
      methodUsed: resolved.methodUsed,
      estimatedHours: resolved.estimatedHours,
      unsupported: Boolean(resolved.unsupported),
      message: resolved.message || null,
      county: resolved.county || buyerCounty || null,
      town: resolved.town || buyerTown || null,
      tier: resolved.tier || null,
      engine: "hybrid",
    });
  }

  return {
    ok: !anyUnsupported,
    error: anyUnsupported ? "unsupported_route" : null,
    message: anyUnsupported
      ? vendorBreakdown.find((v) => v.unsupported)?.message || "Seller cannot deliver to that location."
      : null,
    deliveryMethod,
    buyerCounty: buyerCounty || null,
    buyerTown: buyerTown || null,
    buyerCoordinates,
    isPickupStation,
    vendorBreakdown,
    totalShippingFee,
    /** Explicit aliases for checkout UI / STK wiring */
    shippingFee: totalShippingFee,
    appliedTier: vendorBreakdown
      .map((v) => (v.tier != null ? `Tier ${v.tier}` : v.methodUsed))
      .filter(Boolean),
  };
}
