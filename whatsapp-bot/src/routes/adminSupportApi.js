/**
 * Admin support inbox API — poll-based relay (no Socket.io / Twilio).
 * Auth: X-Admin-Token (same as other /admin routes).
 *
 * Threads:
 * - Order HELP / ADMIN_TAKE_OVER → SKN-#### (communication-hub)
 * - General “talk to a human” → SUP-YYYY-#### (support-inbox)
 *
 * Also exposes the WhatsApp admin #command desk so ops can run without the phone.
 */
import { Router } from "express";
import { requireAdminToken } from "../lib/admin-auth.js";
import { config } from "../config.js";
import { getOrder, listRecentOrders, ORDER_STATUSES, statusLabel } from "../services/orders.js";
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
import {
  adminHelpText,
  executeAdminCommandFromDashboard,
} from "../services/admin.js";
import { filterPendingPaymentClaims } from "../services/payment.js";
import { isDarajaConfigured } from "../services/prepaid-checkout.js";
import { getSettlementSummary } from "../services/settlements.js";
import { orderBuyerTotal } from "../services/shipping-tiers.js";

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

function mapRecentOrder(o) {
  return {
    id: o.id,
    status: o.status,
    statusLabel: statusLabel(o.status),
    productName: o.productName,
    priceKes: o.priceKes,
    buyerTotalKes: orderBuyerTotal(o),
    customerName: o.customerName,
    phone: o.phone,
    location: o.location,
    deliveryMode: o.deliveryMode,
    pickupPointName: o.pickupPointName || null,
    supplierId: o.supplierId || null,
    customerPaymentStatus: o.customerPaymentStatus || null,
    marginKes: o.marginKes ?? null,
    updatedAt: o.updatedAt || o.createdAt || null,
  };
}

/** GET /admin/support/help — WhatsApp admin command cheat-sheet + statuses */
router.get("/help", (_req, res) => {
  res.json({
    ok: true,
    helpText: adminHelpText(),
    statuses: ORDER_STATUSES,
    links: {
      command: "https://sokonimall.com/admin-command.html",
      disputes: "https://sokonimall.com/admin-disputes.html",
      listings: "https://sokonimall.com/admin-seller-listings.html",
      support: "https://sokonimall.com/admin-support.html",
      opsStatus: "/admin/ops/status",
    },
  });
});

/**
 * POST /admin/support/command  { command, quotedText? }
 * Runs the same handlers as the admin WhatsApp number (#orders, #status, …).
 */
router.post("/command", async (req, res) => {
  const command = String(req.body?.command || req.body?.text || "").trim();
  const quotedText = String(req.body?.quotedText || "").trim();
  try {
    const result = await executeAdminCommandFromDashboard(command, quotedText);
    if (!result.ok) {
      const status =
        result.error === "forbidden" || result.error === "admin_phones_unset" ? 403 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error("[admin/support/command]", err);
    res.status(500).json({ ok: false, error: err.message, replies: [] });
  }
});

/** GET /admin/support/desk/orders — recent orders (structured #orders) */
router.get("/desk/orders", (_req, res) => {
  const orders = listRecentOrders(25).map(mapRecentOrder);
  res.json({ ok: true, orders });
});

/** GET /admin/support/desk/payments — unpaid / claimed payments (#payments) */
router.get("/desk/payments", (_req, res) => {
  if (isDarajaConfigured()) {
    const awaiting = listRecentOrders(50)
      .filter((o) => o.status === "awaiting_payment" && o.customerPaymentStatus !== "confirmed")
      .map(mapRecentOrder);
    return res.json({
      ok: true,
      mode: "daraja",
      message: "Daraja STK auto-confirms — #payconfirm is manual fallback only.",
      orders: awaiting,
    });
  }
  const pending = filterPendingPaymentClaims(listRecentOrders(50)).map(mapRecentOrder);
  res.json({
    ok: true,
    mode: "manual",
    message: `Confirm M-Pesa on till ${config.store?.mpesaTill || "—"} first, then Payconfirm.`,
    orders: pending,
  });
});

/** GET /admin/support/desk/payouts — supplier amounts owed (#payouts) */
router.get("/desk/payouts", (_req, res) => {
  try {
    const summary = getSettlementSummary();
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
  const order = getOrder(id);
  res.json({
    ok: true,
    kind: "order",
    threadId: data.orderId,
    ...data,
    order: order ? mapRecentOrder(order) : null,
    statuses: ORDER_STATUSES,
  });
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
