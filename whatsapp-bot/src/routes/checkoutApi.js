import { Router } from "express";
import { checkoutMeta, formatPrepaidCheckoutPrompt, initiateMpesaCheckout } from "../services/prepaid-checkout.js";
import { getOrder } from "../services/orders.js";

const router = Router();

/** GET /api/checkout/meta — prepaid model + Daraja readiness */
router.get("/meta", (_req, res) => {
  res.json(checkoutMeta());
});

/** GET /api/checkout/:orderId — escrow checkout instructions (public, order ref only) */
router.get("/:orderId", (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  res.json({
    orderId: order.id,
    amountKes: order.priceKes,
    paymentStatus: order.customerPaymentStatus,
    escrowStatus: order.escrowStatus || "pending",
    instructions: formatPrepaidCheckoutPrompt(order),
    meta: checkoutMeta(),
  });
});

/** POST /api/checkout/:orderId/stk — Daraja STK stub (Phase 5.1) */
router.post("/:orderId/stk", async (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  if (order.customerPaymentStatus === "confirmed") {
    return res.status(409).json({ error: "already_paid" });
  }
  const result = await initiateMpesaCheckout(order);
  if (!result.ok) {
    return res.status(501).json({
      error: result.method === "daraja_pending" ? "daraja_not_wired" : "checkout_failed",
      message: result.message,
      fallback: formatPrepaidCheckoutPrompt(order),
      meta: checkoutMeta(),
    });
  }
  res.json({ ok: true, ...result });
});

export default router;
