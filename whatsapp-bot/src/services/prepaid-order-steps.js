/**
 * Short multi-step prepaid checkout for WhatsApp:
 * location → fee quote → confirm → name/phone → create + STK
 */

import { getCounty, inferCountyFromText, listTownsForCounty } from "./kenya-locations.js";
import { normalizeKenyanPhone } from "./delivery-details.js";
import { computeFeeBreakdown } from "./shipping-tiers.js";
import {
  findConfiguredVendorProfile,
  normalizeVendorKey,
  resolveVendorShippingFee,
} from "./vendor-shipping.js";

export const ORDER_STEPS = {
  LOCATION: "location",
  CONFIRM_FEES: "confirm_fees",
  CONTACT: "contact",
};

/** @param {{ name: string, priceKes?: number, totalKes?: number, shopHandle?: string, sellerHandle?: string, sellerNetKes?: number }} product */
export function vendorKeyFromProduct(product = {}) {
  return normalizeVendorKey(product.shopHandle || product.sellerHandle || product.supplierId || "");
}

/**
 * Parse "County, Town, Landmark" (or free text we can infer).
 * @returns {{ county: string, town: string, landmark: string, tier: number } | null}
 */
export function parseLocationStep(text) {
  const raw = String(text || "").trim();
  if (raw.length < 3) return null;

  const parts = raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  let county = parts[0] ? getCounty(parts[0]) : null;
  let town = "";
  let landmark = "";

  if (county) {
    town = parts[1] || "";
    landmark = parts.slice(2).join(", ") || parts[1] || "";
    // If part[1] looks like a known town, prefer it
    const towns = listTownsForCounty(county.name);
    const townHit = towns.find((t) => t.name.toLowerCase() === String(parts[1] || "").toLowerCase());
    if (townHit) town = townHit.name;
  } else {
    const inferred = inferCountyFromText(raw);
    if (!inferred?.county) return null;
    county = getCounty(inferred.county);
    if (!county) return null;
    town = inferred.town || parts[0] || "";
    landmark = raw;
  }

  return {
    county: county.name,
    town: town || "",
    landmark: landmark || town || county.name,
    tier: county.tier,
  };
}

/** Name + phone only (location already collected). */
export function parseContactStep(text) {
  const t = String(text || "").trim();
  const phoneMatch = t.match(/(?:\+?254|0)\d[\d\s-]{7,12}\d/);
  if (!phoneMatch) return null;
  const phone = normalizeKenyanPhone(phoneMatch[0]);
  if (!phone) return null;
  const name = t
    .replace(phoneMatch[0], "")
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 3 || name.split(/\s+/).length < 2) return null;
  return { name, phone };
}

/**
 * Build fee quote from seller shipping profile + county.
 * @param {{ sellerNetKes?: number, priceKes?: number, totalKes?: number, shopHandle?: string, sellerHandle?: string }} pendingOrProduct
 * @param {{ county: string, town?: string }} location
 */
export function quoteShippingForPending(pendingOrProduct, location) {
  const { vendorKey, profile } = findConfiguredVendorProfile([
    pendingOrProduct.shopHandle,
    pendingOrProduct.sellerHandle,
    pendingOrProduct.supplierId,
    pendingOrProduct.sellerId,
    pendingOrProduct.sellerPhone,
    vendorKeyFromProduct(pendingOrProduct),
  ]);
  const configured = Boolean(profile);

  // Strict: no Hub rates → do not pretend free shipping / do not continue to STK.
  if (!configured) {
    return {
      ok: false,
      error: "missing_shipping_rates",
      configured: false,
      vendorKey,
      county: location.county,
      town: location.town || "",
      message:
        `❌ *Can't checkout yet*\n\n` +
        `This seller has not set delivery fees for *${location.county || "your area"}*.\n` +
        `Order will not proceed and no M-Pesa prompt will be sent.\n\n` +
        `Try another item, or type *cancel*.`,
    };
  }

  const sellerNet = Math.round(
    Number(pendingOrProduct.sellerNetKes ?? pendingOrProduct.priceKes) || 0
  );

  const resolved = resolveVendorShippingFee({
    vendorKey,
    deliveryMethod: "COUNTY_DROPDOWN",
    buyerCounty: location.county,
    buyerTown: location.town || "",
    profile,
  });

  if (resolved.unsupported) {
    return {
      ok: false,
      error: "unsupported_route",
      configured: true,
      vendorKey,
      county: location.county,
      town: location.town || "",
      message: resolved.message || "Seller can’t deliver there.",
    };
  }

  let shippingFee = Math.round(Number(resolved.shippingFee) || 0);
  const methodUsed = resolved.methodUsed || "TIER";

  // Explicit free shipping only when seller enabled it — never treat missing fee as free.
  if (shippingFee <= 0 && !profile.isFreeShippingEnabled) {
    return {
      ok: false,
      error: "missing_shipping_rates",
      configured: true,
      vendorKey,
      county: location.county,
      town: location.town || "",
      message:
        `❌ *Can't checkout yet*\n\n` +
        `No delivery fee is set for *${location.county || "your area"}*.\n` +
        `No M-Pesa prompt will be sent. Type *cancel* or try another location.`,
    };
  }

  if (profile.isFreeShippingEnabled) shippingFee = 0;

  const fees = computeFeeBreakdown(Math.max(0, sellerNet), shippingFee, {
    freeShipping: shippingFee === 0 && Boolean(profile.isFreeShippingEnabled),
    deliveryMethod: "seller_express",
  });

  const productPortion = Math.max(0, fees.buyerTotalKes - fees.shippingKes);

  return {
    ok: true,
    configured: true,
    vendorKey,
    methodUsed,
    county: location.county,
    town: location.town || "",
    landmark: location.landmark || "",
    tier: location.tier,
    shippingKes: fees.shippingKes,
    itemKes: fees.itemKes,
    sellerNetKes: fees.sellerNetKes,
    platformFeeKes: fees.platformFeeKes,
    shippingCommissionKes: fees.shippingCommissionKes,
    transactionFeeKes: fees.transactionFeeKes,
    sellerPayoutKes: fees.sellerPayoutKes,
    totalKes: fees.buyerTotalKes,
    productDisplayKes: productPortion,
    freeShipping: Boolean(profile.isFreeShippingEnabled) && fees.shippingKes === 0,
  };
}

export function locationPrompt(productName) {
  return (
    `*${productName}*\n\n` +
    `Where should we deliver?\n` +
    `Reply: *County, Town, delivery spot*\n` +
    `_e.g. Kiambu, Ruiru, Quickmart gate_\n\n` +
    `Type *cancel* to stop.`
  );
}

export function feeBreakdownPrompt(productName, quote) {
  const shipLine =
    quote.shippingKes > 0
      ? `Delivery (${quote.county}): KES ${quote.shippingKes.toLocaleString()}`
      : `Delivery (${quote.county}): KES 0`;
  return (
    `*${productName}*\n\n` +
    `Product: KES ${Number(quote.productDisplayKes).toLocaleString()}\n` +
    `${shipLine}\n` +
    `*Total: KES ${Number(quote.totalKes).toLocaleString()}*\n\n` +
    `1 — Continue\n` +
    `2 — Change location`
  );
}

export function contactPrompt() {
  return (
    `Your details for delivery + M-Pesa:\n` +
    `Reply: *First Last, 07xxxxxxxx*\n` +
    `_e.g. Jane Wanjiru, 0712345678_`
  );
}

export function shortOrderPlacedMessage({ orderId, productName, totalKes, shippingKes, county, phone }) {
  const ship =
    Number(shippingKes) > 0
      ? ` · delivery ${county || ""} KES ${Number(shippingKes).toLocaleString()}`.replace("  ", " ")
      : "";
  return (
    `✅ *${orderId}*\n` +
    `${productName}\n` +
    `*KES ${Number(totalKes).toLocaleString()}*${ship}\n` +
    `📱 ${phone}`
  );
}

export function shortStkPrompt(orderId, totalKes) {
  return (
    `💳 *${orderId}* — *KES ${Number(totalKes).toLocaleString()}*\n` +
    `STK sent — enter your M-Pesa PIN.`
  );
}

export function shortStkFailPrompt(orderId, totalKes, payUrl) {
  return (
    `Couldn't start M-Pesa for *${orderId}* (KES ${Number(totalKes).toLocaleString()}).\n` +
    `Reply *pay* to retry.` +
    (payUrl ? `\nOr pay: ${payUrl}` : "")
  );
}
