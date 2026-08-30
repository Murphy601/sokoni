/**
 * Block STK when seller has not configured Hub shipping rates for delivery orders.
 * Cancels the order and notifies buyer + seller with structured WA copy.
 */
import { getOrder, updateOrderMeta, updateOrderStatus } from "./orders.js";
import {
  findConfiguredVendorProfile,
  isConfiguredShippingProfile,
} from "./vendor-shipping.js";
import { ensureHybridShippingBeforePayment } from "./apply-order-shipping.js";
import { msgBuyerShippingCancel, msgSellerShippingCancel } from "../lib/wa-ux.js";

function isPickupOnly(order) {
  const mode = String(order?.deliveryMode || order?.deliveryType || "").toLowerCase();
  if (mode.includes("pickup") || order?.isPickupStation) return true;
  if (String(order?.deliveryMethodCalc || "").toUpperCase() === "PICKUP_STATION") return true;
  return false;
}

function vendorCandidates(order) {
  return [order.shopHandle, order.supplierId, order.sellerId, order.sellerPhone];
}

/**
 * @returns {{ needsShipping: boolean, configured: boolean, profile: object|null, vendorKey: string }}
 */
export function inspectOrderShippingReadiness(order) {
  if (!order?.id) return { needsShipping: false, configured: true, profile: null, vendorKey: "" };
  if (isPickupOnly(order)) {
    return { needsShipping: false, configured: true, profile: null, vendorKey: "" };
  }
  // Upcountry seller-courier can still need rates, but gate focuses on local delivery.
  if (order.requiresRider === false && order.fulfillmentMode && /courier|waybill/i.test(String(order.fulfillmentMode))) {
    const found = findConfiguredVendorProfile(vendorCandidates(order));
    const configured = isConfiguredShippingProfile(found.profile);
    return { needsShipping: true, configured, profile: found.profile, vendorKey: found.vendorKey };
  }
  const found = findConfiguredVendorProfile(vendorCandidates(order));
  const configured = isConfiguredShippingProfile(found.profile);
  return { needsShipping: true, configured, profile: found.profile, vendorKey: found.vendorKey };
}

async function resolveSellerNotifyTarget(order) {
  try {
    const { getSupplier, findSupplierByPhone } = await import("./suppliers.js");
    const sup =
      (order.supplierId && getSupplier(order.supplierId)) ||
      findSupplierByPhone(order.sellerPhone) ||
      null;
    const phone = String(sup?.phone || order.sellerPhone || "").replace(/\D/g, "");
    if (phone.length >= 9) return { phone, shop: sup?.shopName || order.shopHandle || "your shop" };
  } catch {
    /* ignore */
  }
  const phone = String(order.sellerPhone || "").replace(/\D/g, "");
  return phone.length >= 9 ? { phone, shop: order.shopHandle || "your shop" } : null;
}

/**
 * Cancel unpaid order + WhatsApp buyer/seller. Idempotent if already cancelled.
 */
export async function cancelOrderMissingShipping(orderIn, { reason = "missing_shipping_rates" } = {}) {
  const order = orderIn?.id ? getOrder(orderIn.id) || orderIn : orderIn;
  if (!order?.id) return { ok: false, error: "missing_order" };
  if (order.customerPaymentStatus === "confirmed") {
    return { ok: false, error: "already_paid" };
  }
  if (order.status === "cancelled") {
    return { ok: true, already: true, order };
  }

  const region =
    [order.deliveryCounty, order.deliveryTown, order.location].filter(Boolean).join(" · ") ||
    "your area";
  const itemName = order.productName || order.itemName || "item";

  updateOrderStatus(order.id, "cancelled");
  updateOrderMeta(order.id, {
    paymentStatus: "cancelled",
    cancelReason: reason,
    cancelledAt: Date.now(),
    shippingGate: "blocked_stk",
  });

  const { sendText } = await import("./whatsapp.js");
  const buyerTo = order.customerKey || (order.phone ? `${String(order.phone).replace(/\D/g, "")}@c.us` : null);
  if (buyerTo) {
    try {
      await sendText(buyerTo, msgBuyerShippingCancel(order.id, itemName));
    } catch (err) {
      console.warn("[shipping-gate] buyer notify:", err.message);
    }
  }

  const seller = await resolveSellerNotifyTarget(order);
  if (seller?.phone) {
    try {
      await sendText(`${seller.phone}@c.us`, msgSellerShippingCancel(order.id, itemName, region));
    } catch (err) {
      console.warn("[shipping-gate] seller notify:", err.message);
    }
  }

  console.warn(`[shipping-gate] cancelled ${order.id} — ${reason}`);
  return { ok: true, cancelled: true, order: getOrder(order.id) };
}

/**
 * Ensure shipping is configured + priced from Seller Hub before STK.
 * Never accept product-listing shippingKes / invented defaults as "configured".
 *
 * Note: STK amounts like KES 61 on a ~KES 55 item are usually sellerNet + 10%
 * platform fee with shippingKes=0 — not a mysterious KES 6 shipping fallback.
 *
 * @returns {{ ok: true, order } | { ok: false, cancelled?: boolean, error: string, message: string, order?: object }}
 */
export async function gateShippingBeforeStk(orderIn) {
  const order = orderIn?.id ? getOrder(orderIn.id) || orderIn : orderIn;
  if (!order?.id) return { ok: false, error: "missing_order", message: "Missing order" };
  if (order.customerPaymentStatus === "confirmed") {
    return { ok: true, order };
  }
  if (isPickupOnly(order)) {
    return { ok: true, order, skipped: "pickup" };
  }

  // Cart parent: every child vendor must be configured.
  if (order.kind === "cart_parent") {
    const childIds = Array.isArray(order.itemIds) ? order.itemIds : [];
    for (const cid of childIds) {
      const child = getOrder(cid);
      if (!child) continue;
      const ready = inspectOrderShippingReadiness(child);
      if (ready.needsShipping && !ready.configured) {
        const cancelled = await cancelOrderMissingShipping(order, {
          reason: "missing_shipping_rates_cart",
        });
        return {
          ok: false,
          cancelled: true,
          error: "missing_shipping_rates",
          message: msgBuyerShippingCancel(order.id, child.productName || "cart item"),
          order: cancelled.order,
        };
      }
    }
  } else {
    const ready = inspectOrderShippingReadiness(order);
    if (ready.needsShipping && !ready.configured) {
      const cancelled = await cancelOrderMissingShipping(order, {
        reason: "missing_shipping_rates",
      });
      return {
        ok: false,
        cancelled: true,
        error: "missing_shipping_rates",
        message: msgBuyerShippingCancel(order.id, order.productName || "item"),
        order: cancelled.order,
      };
    }
  }

  // Apply Hub rates into totals when profile exists.
  try {
    const ensured = await ensureHybridShippingBeforePayment(order);
    const next = ensured?.order || getOrder(order.id) || order;
    const found = findConfiguredVendorProfile(vendorCandidates(next));
    const freeOk = Boolean(found.profile?.isFreeShippingEnabled);
    const ship = Math.round(Number(next.shippingKes) || 0);
    const hubPriced = isHubPricedShipping(next);

    // ensureHybrid now fail-closes on no_profile / county_unknown / apply_failed.
    // Still allow when Hub quote already stamped shippingSource=hub with a positive fee,
    // or seller explicitly enabled free shipping.
    if (ensured && ensured.ok === false) {
      if (freeOk && ship <= 0) {
        return { ok: true, order: next, applied: false, freeShipping: true };
      }
      if (hubPriced && ship > 0) {
        return { ok: true, order: next, applied: false, fromQuote: true };
      }
      const cancelled = await cancelOrderMissingShipping(next, {
        reason: ensured.reason || "shipping_ensure_failed",
      });
      return {
        ok: false,
        cancelled: true,
        error: "missing_shipping_rates",
        message: msgBuyerShippingCancel(next.id, next.productName || "item"),
        order: cancelled.order,
      };
    }

    // Zero shipping without explicit free-ship → block (this is the KES 55+10%=61 path).
    if (!isPickupOnly(next) && ship <= 0 && !freeOk) {
      const cancelled = await cancelOrderMissingShipping(next, {
        reason: "missing_rate_for_region",
      });
      return {
        ok: false,
        cancelled: true,
        error: "missing_shipping_rates",
        message: msgBuyerShippingCancel(next.id, next.productName || "item"),
        order: cancelled.order,
      };
    }

    // Positive shipping must come from Hub matrix — never product.listing shippingKes alone.
    if (!isPickupOnly(next) && ship > 0 && !hubPriced && !freeOk) {
      const cancelled = await cancelOrderMissingShipping(next, {
        reason: "listing_shipping_not_hub",
      });
      return {
        ok: false,
        cancelled: true,
        error: "missing_shipping_rates",
        message: msgBuyerShippingCancel(next.id, next.productName || "item"),
        order: cancelled.order,
      };
    }

    return { ok: true, order: next, applied: Boolean(ensured?.applied) };
  } catch (err) {
    console.error("[shipping-gate] ensure FAILED — blocking STK:", err.message);
    const cancelled = await cancelOrderMissingShipping(order, {
      reason: "shipping_ensure_error",
    });
    return {
      ok: false,
      cancelled: true,
      error: "shipping_gate_error",
      message: msgBuyerShippingCancel(order.id, order.productName || "item"),
      order: cancelled.order || getOrder(order.id) || order,
    };
  }
}

/** True when shippingKes was priced from Seller Hub (quote or apply), not product row. */
function isHubPricedShipping(order) {
  if (!order) return false;
  if (order.shippingSource === "hub" || order.shippingSource === "vendor_hub") return true;
  const meta = order.shippingCalcMeta || {};
  if (meta.moneyApplied === true || meta.profilePresent === true) return true;
  const method = String(meta.methodUsed || "");
  if (!method || method === "NO_PROFILE" || /^PRODUCT/i.test(method)) return false;
  return true;
}
