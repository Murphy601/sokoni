/**
 * Admin support inbox API — poll-based relay (no Socket.io / Twilio).
 * Auth: X-Admin-Token (same as other /admin routes).
 *
 * Threads:
 * - Order HELP / ADMIN_TAKE_OVER → SKN-#### (communication-hub)
 * - General “talk to a human” → SUP-YYYY-#### (support-inbox)
 */
import { Router } from "express";
import { requireAdminToken } from "../lib/admin-auth.js";
import { getOrder } from "../services/orders.js";
import {
  listSupportOrders,
  getSupportThread,
  recordAdminOutbound,
  resolveAdminTakeOver,
  dispatchMessages,
  getOrderPartyChats,
} from "../services/communication-hub.js";
import { setHumanHandoff } from "../services/session.js";
import {
  isGeneralSupportId,
  listOpenGeneralSupportTickets,
  getGeneralSupportTicket,
  replyGeneralSupportTicket,
  resolveGeneralSupportTicket,
} from "../services/support-inbox.js";

const router = Router();
router.use(requireAdminToken);

function mapOrderThread(o) {
  return {
    threadId: o.orderId,
    kind: "order",
    orderId: o.orderId,
    productName: o.productName || null,
    label: o.productName || o.orderId,
    lifecycle: o.lifecycle,
    adminTakeOver: o.adminTakeOver,
    disputeHold: o.disputeHold,
    dropOff: o.dropOff,
    buyerPhone: o.buyerPhone,
    customerKey: o.customerKey,
    threadCount: o.threadCount,
    updatedAt: o.updatedAt,
    lastMessage: null,
  };
}

/** GET /admin/support/orders — unified open threads (orders + general). */
router.get("/orders", (_req, res) => {
  const orders = listSupportOrders({ limit: 50 });
  const general = listOpenGeneralSupportTickets({ limit: 50 });
  const threads = [...general, ...orders.map(mapOrderThread)].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );
  res.json({ ok: true, threads, orders });
});

/** GET /admin/support/:orderId — order SKN or general SUP ticket */
router.get("/:orderId", (req, res) => {
  const id = String(req.params.orderId || "").trim();
  if (isGeneralSupportId(id)) {
    const data = getGeneralSupportTicket(id);
    if (data.error) return res.status(404).json(data);
    return res.json({ ok: true, ...data });
  }
  const data = getSupportThread(id);
  if (data.error) return res.status(404).json(data);
  res.json({ ok: true, kind: "order", threadId: data.orderId, ...data });
});

/** POST /admin/support/:orderId/reply  { message } */
router.post("/:orderId/reply", async (req, res) => {
  const id = String(req.params.orderId || "").trim();
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "missing_message" });

  if (isGeneralSupportId(id)) {
    const result = await replyGeneralSupportTicket(id, message);
    if (result.error === "not_found") return res.status(404).json(result);
    if (result.error) return res.status(400).json(result);
    return res.json(result);
  }

  const order = getOrder(id);
  if (!order) return res.status(404).json({ error: "not_found" });
  if (!order.customerKey) {
    return res.status(400).json({ error: "no_buyer_chat", message: "Order has no buyer WhatsApp key." });
  }

  try {
    const body = `🛡️ *[Sokoni Support]:* ${message}`;
    const parties = await getOrderPartyChats(order);
    if (!parties.buyer.length && !parties.seller.length) {
      return res.status(400).json({
        error: "no_party_chat",
        message: "Order has no buyer or seller WhatsApp chat to message.",
      });
    }
    const jobs = [];
    if (parties.buyer.length) {
      for (const to of parties.buyer) jobs.push({ to, message: body });
    }
    if (parties.seller.length) {
      for (const to of parties.seller) jobs.push({ to, message: body });
    }
    const results = await dispatchMessages(jobs);
    const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value?.success));
    if (failed.length === results.length) {
      const err =
        failed[0]?.reason?.message ||
        failed[0]?.value?.error ||
        "WhatsApp send failed";
      return res.status(502).json({ error: "send_failed", message: err });
    }
    if (order.customerKey) {
      setHumanHandoff(order.customerKey, {
        adminDirect: true,
        adminTakeOver: true,
        orderId: order.id,
        startedAt: Date.now(),
        ackSent: true,
      });
    }
    recordAdminOutbound(order.id, message, { setTakeOver: true });
    res.json({
      ok: true,
      orderId: order.id,
      threadId: order.id,
      kind: "order",
      notified: {
        buyer: parties.buyer.length > 0,
        seller: parties.seller.length > 0,
      },
      thread: getSupportThread(order.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /admin/support/:orderId/resolve */
router.post("/:orderId/resolve", async (req, res) => {
  const id = String(req.params.orderId || "").trim();
  const note = String(req.body?.note || "resolved via admin support UI").slice(0, 200);

  if (isGeneralSupportId(id)) {
    const result = await resolveGeneralSupportTicket(id, { note });
    if (result.error) return res.status(404).json(result);
    return res.json({ ok: true, ...result });
  }

  const result = await resolveAdminTakeOver(id, { note });
  if (result.error) return res.status(404).json(result);
  res.json({ ok: true, order: result.order, thread: getSupportThread(id) });
});

export default router;
