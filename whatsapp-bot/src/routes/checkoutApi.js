import { Router } from "express";
import {
  checkoutMeta,
  formatPrepaidCheckoutPrompt,
  initiateMpesaCheckout,
  checkoutUrlForOrder,
  labelPageUrlForOrder,
} from "../services/prepaid-checkout.js";
import { generateDropoffLabel } from "../services/escrow-automation.js";
import { getOrder } from "../services/orders.js";
import { orderBuyerTotal } from "../services/shipping-tiers.js";
import { config } from "../config.js";
import { listLandmarkHubs, formatLandmarkLine } from "../lib/landmark-hubs.js";
import { calculateShipping } from "../services/calculate-shipping.js";
import { applyShippingToOrder } from "../services/apply-order-shipping.js";
import { listCounties, listTownsForCounty, loadKenyaLocations } from "../services/kenya-locations.js";

const router = Router();

router.get("/meta", (_req, res) => {
  res.json({
    ...checkoutMeta(),
    hybridLogistics: true,
    paymentRail: checkoutMeta().paymentRail || "mpesa_stk",
  });
});

/** Curated Kenyan hubs / landmarks for checkout dropdowns. */
router.get("/landmarks", (_req, res) => {
  const data = listLandmarkHubs();
  res.json({ success: true, ...data });
});

/** 47 counties + 4 tiers (public). */
router.get("/locations/counties", (_req, res) => {
  const data = loadKenyaLocations();
  res.json({ success: true, tiers: data.tiers, counties: listCounties() });
});

router.get("/locations/towns", (req, res) => {
  const county = String(req.query.county || "").trim();
  if (!county) return res.status(400).json({ error: "county_required" });
  res.json({ success: true, county, towns: listTownsForCounty(county) });
});

/** POST /api/checkout/calculate-shipping — hybrid fee engine (totals only). */
router.post("/calculate-shipping", async (req, res) => {
  try {
    const result = await calculateShipping(req.body || {});
    const status = result.error === "empty_cart" ? 400 : result.ok ? 200 : 422;
    res.status(status).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: "calc_failed", message: err.message });
  }
});

/** POST /api/checkout/:orderId/apply-shipping — mutate order shipping before M-Pesa STK. */
router.post("/:orderId/apply-shipping", async (req, res) => {
  try {
    const result = await applyShippingToOrder(req.params.orderId, {
      deliveryMethod: req.body?.deliveryMethod,
      buyerCoordinates: req.body?.buyerCoordinates,
      buyerCounty: req.body?.buyerCounty,
      buyerTown: req.body?.buyerTown,
      isPickupStation: req.body?.isPickupStation,
      landmarkNote: req.body?.landmarkNote || req.body?.instructions,
      deliveryType: req.body?.deliveryType,
    });
    if (!result.ok) {
      const code =
        result.error === "order_not_found"
          ? 404
          : result.error === "already_paid"
            ? 409
            : 422;
      return res.status(code).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: "apply_failed", message: err.message });
  }
});

/** Prepaid drop-off label / QR payload for seller. */
router.get("/:orderId/label", (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: "order_not_found" });
  const label = generateDropoffLabel(order);
  const paid = order.customerPaymentStatus === "confirmed";
  res.json({
    orderId: order.id,
    productName: order.productName || null,
    buyerLocation: order.location || null,
    landmarkLine: formatLandmarkLine(order) || null,
    deliveryType: order.deliveryType || null,
    landmarkTown: order.landmarkTown || null,
    landmarkSpot: order.landmarkSpot || null,
    buyerName: order.name || order.customerName || null,
    pickupPointName: order.pickupPointName || null,
    pickupPointPhone: order.pickupPointPhone || null,
    deliveryMethod: order.deliveryMethod || "hub",
    dropOffCode: label.dropOffCode,
    trackingCode: label.trackingCode,
    qrPayload: label.qrPayload,
    shipmentStatus: order.shipmentStatus || label.shipmentStatus,
    paid,
    labelUrl: label.labelUrl,
    trackUrl: `${config.publicSiteUrl}/track.html?order=${encodeURIComponent(order.id)}`,
    instructions: label.instructions,
    message: paid
      ? "Print this label and drop the parcel at a Sokoni hub."
      : "Payment not confirmed yet — label unlocks after M-Pesa payment.",
  });
});

router.get("/:orderId", (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  const shippingKes = Math.round(Number(order.shippingKes) || 0);
  const totalKes = orderBuyerTotal(order);
  const itemKes = Math.round(
    Number(order.sellerNetKes ?? order.priceKes) || Math.max(0, totalKes - shippingKes)
  );
  const shopHandle = order.shopHandle || null;
  const supplierId = order.supplierId || order.sellerId || null;
  res.json({
    orderId: order.id,
    productName: order.productName,
    itemKes,
    shippingKes,
    amountKes: totalKes,
    totalKes,
    deliveryCounty: order.deliveryCounty || null,
    deliveryTown: order.deliveryTown || null,
    shopHandle,
    supplierId,
    vendorId: String(shopHandle || supplierId || "")
      .trim()
      .toLowerCase()
      .replace(/^@/, "") || null,
    paymentStatus: order.customerPaymentStatus,
    paymentStatusDetail: order.paymentStatus,
    escrowStatus: order.escrowStatus || "pending",
    shipmentStatus: order.shipmentStatus,
    dropOffCode: order.dropOffCode,
    labelUrl: order.customerPaymentStatus === "confirmed" ? labelPageUrlForOrder(order.id) : order.labelUrl || null,
    checkoutUrl: checkoutUrlForOrder(order.id),
    trackUrl: `${config.publicSiteUrl}/track.html?order=${encodeURIComponent(order.id)}`,
    instructions: formatPrepaidCheckoutPrompt(order),
    meta: checkoutMeta(),
  });
});

/** POST /api/checkout/:orderId/stk — M-Pesa STK (Paystack Charge, Daraja fallback). */
router.post("/:orderId/stk", async (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  if (order.customerPaymentStatus === "confirmed") {
    return res.status(409).json({ error: "already_paid" });
  }
  const phone = req.body?.phone || order.phone;
  const result = await initiateMpesaCheckout(order, { phone });
  const fresh = getOrder(order.id) || order;
  if (!result.ok) {
    return res.status(502).json({
      error: result.method || "checkout_failed",
      message: result.message,
      fallback: formatPrepaidCheckoutPrompt(fresh),
      amountKes: orderBuyerTotal(fresh),
      shippingKes: Math.round(Number(fresh.shippingKes) || 0),
      meta: checkoutMeta(),
    });
  }
  res.json({
    ok: true,
    ...result,
    amountKes: result.amountKes ?? orderBuyerTotal(fresh),
    shippingKes: result.shippingKes ?? Math.round(Number(fresh.shippingKes) || 0),
    totalKes: orderBuyerTotal(fresh),
    instructions: formatPrepaidCheckoutPrompt(fresh),
    meta: checkoutMeta(),
  });
});

export default router;
