import { Router } from "express";
import { getOrder } from "../services/orders.js";
import { buildPublicTrackingPayload, trackingMeta } from "../services/shipments.js";
import { getRiderLocation, setRiderLocation } from "../services/rider-tracking.js";
import { requireAdminToken } from "../lib/admin-auth.js";

const router = Router();

router.get("/meta", (_req, res) => {
  res.json({
    ...trackingMeta(),
    riderLive: true,
    pollPath: "/api/tracking/:orderId/rider",
  });
});

/** Public rider pin for map (no payment secrets). */
router.get("/:orderId/rider", (req, res) => {
  const loc = getRiderLocation(req.params.orderId);
  if (!loc) return res.status(404).json({ error: "order_not_found" });
  res.json({ success: true, location: loc });
});

/**
 * Ops / rider app: update GPS.
 * Guarded by admin token (same family as shipment scans) — never public write.
 */
router.post("/:orderId/rider", requireAdminToken, (req, res) => {
  const result = setRiderLocation(req.params.orderId, {
    lat: req.body?.lat,
    lng: req.body?.lng,
    heading: req.body?.heading,
    speed: req.body?.speed,
  });
  if (!result.ok) {
    return res.status(result.error === "order_not_found" ? 404 : 400).json(result);
  }
  res.json(result);
});

/** Public SKN-#### / SKN-####-n / legacy SK-#### tracking — no payment internals exposed. */
router.get("/:orderId", (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  const payload = buildPublicTrackingPayload(order);
  const rider = getRiderLocation(order.id);
  res.json({
    tracking: {
      ...payload,
      buyerLat: order.buyerLat ?? null,
      buyerLng: order.buyerLng ?? null,
      deliveryCounty: order.deliveryCounty ?? null,
      deliveryTown: order.deliveryTown ?? null,
    },
    rider,
  });
});

export default router;
