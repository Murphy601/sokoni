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

const router = Router();

router.get("/meta", (_req, res) => {
  res.json(checkoutMeta());
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
  res.json({
    orderId: order.id,
    productName: order.productName,
    amountKes: orderBuyerTotal(order),
    totalKes: orderBuyerTotal(order),
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

/** POST /api/checkout/:orderId/stk — Daraja STK push */
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
  if (!result.ok) {
    return res.status(502).json({
      error: result.method || "checkout_failed",
      message: result.message,
      fallback: formatPrepaidCheckoutPrompt(order),
      meta: checkoutMeta(),
    });
  }
  res.json({
    ok: true,
    ...result,
    instructions: formatPrepaidCheckoutPrompt(getOrder(order.id)),
    meta: checkoutMeta(),
  });
});

export default router;
