/**
 * Admin support inbox API — poll-based relay (no Socket.io / Twilio).
 * Auth: X-Admin-Token (same as other /admin routes).
 */
import { Router } from "express";
import { requireAdminToken } from "../lib/admin-auth.js";
import { getOrder } from "../services/orders.js";
import { sendText } from "../services/whatsapp.js";
import {
  listSupportOrders,
  getSupportThread,
  recordAdminOutbound,
  resolveAdminTakeOver,
} from "../services/communication-hub.js";
import { setHumanHandoff } from "../services/session.js";

const router = Router();
router.use(requireAdminToken);

/** GET /admin/support/orders */
router.get("/orders", (_req, res) => {
  res.json({ ok: true, orders: listSupportOrders({ limit: 50 }) });
});

/** GET /admin/support/:orderId */
router.get("/:orderId", (req, res) => {
  const data = getSupportThread(req.params.orderId);
  if (data.error) return res.status(404).json(data);
  res.json({ ok: true, ...data });
});

/** POST /admin/support/:orderId/reply  { message } */
router.post("/:orderId/reply", async (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: "not_found" });
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "missing_message" });
  if (!order.customerKey) {
    return res.status(400).json({ error: "no_buyer_chat", message: "Order has no buyer WhatsApp key." });
  }

  try {
    const body = `🛡️ *[Sokoni Support]:* ${message}`;
    await sendText(order.customerKey, body);
    setHumanHandoff(order.customerKey, {
      adminDirect: true,
      adminTakeOver: true,
      orderId: order.id,
      startedAt: Date.now(),
      ackSent: true,
    });
    recordAdminOutbound(order.id, message, { setTakeOver: true });
    res.json({ ok: true, orderId: order.id, thread: getSupportThread(order.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /admin/support/:orderId/resolve */
router.post("/:orderId/resolve", async (req, res) => {
  const result = await resolveAdminTakeOver(req.params.orderId, {
    note: String(req.body?.note || "resolved via admin support UI").slice(0, 200),
  });
  if (result.error) return res.status(404).json(result);
  res.json({ ok: true, order: result.order, thread: getSupportThread(req.params.orderId) });
});

export default router;
