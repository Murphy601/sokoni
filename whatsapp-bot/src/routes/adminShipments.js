import { Router } from "express";
import { config } from "../config.js";
import { getOrder } from "../services/orders.js";
import {
  advanceShipmentStatus,
  scanShipmentAtHub,
  assignCourier,
  buildPublicTrackingPayload,
} from "../services/shipments.js";

const router = Router();

function isAdminTokenValid(token) {
  const expected =
    process.env.ADMIN_SETUP_TOKEN ||
    process.env.SUPPLIER_ADMIN_TOKEN ||
    config.tiktok.setupToken ||
    "";
  return expected && token === expected;
}

function requireToken(req, res, next) {
  if (!isAdminTokenValid(req.query.token)) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

router.use(requireToken);

router.get("/:orderId", (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: "not_found" });
  res.json({ tracking: buildPublicTrackingPayload(order), orderId: order.id });
});

/** Hub scan — advance shipment one step or force status. */
router.post("/:orderId/scan", (req, res) => {
  const orderId = req.params.orderId;
  const { status, hub, courier, trackingRef, note } = req.body || {};
  const meta = {
    hubName: hub,
    courierName: courier,
    trackingRef,
    note,
    actor: "hub_api",
  };
  const result = status
    ? advanceShipmentStatus(orderId, status, meta)
    : scanShipmentAtHub(orderId, meta);

  if (result.error) return res.status(400).json(result);

  res.json({
    ok: true,
    orderId: result.order.id,
    shipmentStatus: result.order.shipmentStatus,
    tracking: buildPublicTrackingPayload(result.order),
  });
});

router.post("/:orderId/courier", (req, res) => {
  const { courier = "manual", trackingRef = "", note = "" } = req.body || {};
  const result = assignCourier(req.params.orderId, { courier, trackingRef, note });
  if (result.error) return res.status(404).json(result);
  res.json({ ok: true, order: result.order });
});

export default router;
