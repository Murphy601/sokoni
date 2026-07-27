import { Router } from "express";
import { confirmOrderDelivery } from "../services/seller-onboard.js";

const router = Router();

/** POST /api/orders/confirm-delivery — mark delivered + schedule/release payout */
router.post("/confirm-delivery", async (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: "missing_order_id" });
  }
  const result = await confirmOrderDelivery(String(orderId).trim());
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

export default router;
