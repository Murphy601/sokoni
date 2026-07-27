import { Router } from "express";
import { getOrder } from "../services/orders.js";
import { buildPublicTrackingPayload, trackingMeta } from "../services/shipments.js";

const router = Router();

router.get("/meta", (_req, res) => {
  res.json(trackingMeta());
});

/** Public SK-#### tracking — no payment internals exposed. */
router.get("/:orderId", (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  const payload = buildPublicTrackingPayload(order);
  res.json({ tracking: payload });
});

export default router;
