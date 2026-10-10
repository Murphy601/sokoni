/**
 * Parameterized ops tools for the admin tool-calling agent.
 * The model never writes SQL — every query is a named function with validated args.
 */
import { isDbEnabled, query } from "../db/pool.js";
import { normalizeKenyaPhone } from "../lib/phone-normalize.js";
import { normalizeOrderId } from "../lib/order-id.js";
import {
  getOrder,
  listAllOrders,
  getOrdersForCustomer,
  getAllContacts,
} from "./orders.js";
import { inspectionWindowOpen, inspectionRemainingLabel } from "../agents/inspection-window.js";
import { sendText, toChatId } from "./whatsapp.js";
import { config } from "../config.js";

const HOUR_MS = 60 * 60 * 1000;
const LOCAL_AUTO_RELEASE_MS = 24 * HOUR_MS;
const UPCOUNTRY_AUTO_RELEASE_MS = 48 * HOUR_MS;
const SEND_MAX_CHARS = 800;
const SEND_PER_MINUTE = 10;

let sendTimestamps = [];

export const OPS_TOOL_NAMES = [
  "get_inquiry_metrics",
  "get_rider_roster",
  "check_escrow_status",
  "lookup_order_history",
  "send_whatsapp_message",
];

export function parseDateRange(raw, now = Date.now()) {
  const key = String(raw || "7d")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const map = {
    today: 24 * HOUR_MS,
    "24h": 24 * HOUR_MS,
    "1d": 24 * HOUR_MS,
    "7d": 7 * 24 * HOUR_MS,
    week: 7 * 24 * HOUR_MS,
    this_week: 7 * 24 * HOUR_MS,
    "30d": 30 * 24 * HOUR_MS,
    month: 30 * 24 * HOUR_MS,
    this_month: 30 * 24 * HOUR_MS,
  };
  const ms = map[key] ?? (/^\d+d$/.test(key) ? Number.parseInt(key, 10) * 24 * HOUR_MS : 7 * 24 * HOUR_MS);
  const clamped = Math.min(90 * 24 * HOUR_MS, Math.max(HOUR_MS, ms));
  return { label: key in map ? key : `${Math.round(clamped / (24 * HOUR_MS))}d`, sinceMs: now - clamped, untilMs: now };
}

export function normalizeOpsPhone(raw) {
  return normalizeKenyaPhone(raw);
}

function phoneOfOrder(order) {
  return normalizeOpsPhone(order?.phone || order?.mpesaPhone || order?.customerKey || "");
}

function nameOfOrder(order) {
  return String(order?.customerName || order?.buyerName || order?.details?.name || "").trim();
}

function matchesName(order, name) {
  const want = String(name || "").trim().toLowerCase();
  if (!want || want.length < 2) return false;
  const hay = [nameOfOrder(order), order?.productName, order?.shopHandle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(want);
}

export function findOrdersForOps({ orderId, phoneNumber, customerName } = {}) {
  const id = normalizeOrderId(orderId);
  if (id) {
    const one = getOrder(id);
    if (one) return [one];
  }
  const phone = normalizeOpsPhone(phoneNumber);
  if (phone) {
    const byPhone = getOrdersForCustomer("", phone);
    if (byPhone.length) return byPhone;
  }
  const name = String(customerName || "").trim();
  if (name.length >= 2) {
    return listAllOrders()
      .filter((o) => o.kind !== "cart_child" && matchesName(o, name))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  return [];
}

export function escrowSnapshot(order, now = Date.now()) {
  if (!order) return null;
  const escrow = String(order.escrowStatus || "unknown").toLowerCase();
  const delivered =
    order.status === "delivered" ||
    order.shipmentStatus === "delivered" ||
    Boolean(order.deliveredAt || order.buyerConfirmedAt);
  const deliveredAt = Number(order.deliveredAt || order.buyerConfirmedAt || 0) || null;
  const holdHours = Number(order.autoReleaseHours || order.escrowHoldHours) || (order.fulfillmentMode === "seller_courier" ? 48 : 24);
  const holdMs = holdHours >= 40 ? UPCOUNTRY_AUTO_RELEASE_MS : LOCAL_AUTO_RELEASE_MS;
  const inspectionOpen = inspectionWindowOpen(order, now);
  const autoReleaseAt = deliveredAt ? deliveredAt + holdMs : null;
  const autoReleaseActive =
    escrow === "held" &&
    delivered &&
    !order.isPaidOut &&
    !order.disputeHold &&
    autoReleaseAt != null &&
    now < autoReleaseAt;

  return {
    orderId: order.id,
    productName: order.productName || null,
    customerName: nameOfOrder(order) || null,
    phone: phoneOfOrder(order) || null,
    status: order.status || null,
    shipmentStatus: order.shipmentStatus || null,
    escrowStatus: order.escrowStatus || null,
    paymentStatus: order.customerPaymentStatus || order.paymentStatus || null,
    totalKes: order.totalKes ?? order.priceKes ?? null,
    delivered,
    inspectionWindowActive: inspectionOpen,
    inspectionRemaining: inspectionOpen ? inspectionRemainingLabel(order.inspectionEndsAt, now) : null,
    autoReleaseHours: holdHours,
    autoReleaseActive,
    autoReleaseAt,
    hoursUntilAutoRelease:
      autoReleaseActive && autoReleaseAt ? Math.max(0, Math.round((autoReleaseAt - now) / HOUR_MS)) : null,
    disputeHold: Boolean(order.disputeHold),
    isPaidOut: Boolean(order.isPaidOut),
  };
}

async function inquiryMetricsFromDb(sinceIso, untilIso) {
  const { rows } = await query(
    `SELECT
        COUNT(*)::int AS buyer_to_seller,
        COUNT(DISTINCT m.sender_user_id)::int AS unique_buyers,
        COUNT(DISTINCT m.receiver_user_id)::int AS unique_sellers
     FROM messages m
     JOIN users sender ON sender.id = m.sender_user_id
     JOIN users receiver ON receiver.id = m.receiver_user_id
     WHERE m.created_at >= $1::timestamptz
       AND m.created_at < $2::timestamptz
       AND COALESCE(sender.role, 'buyer') = 'buyer'
       AND receiver.role IN ('seller', 'admin')`,
    [sinceIso, untilIso]
  );
  const row = rows[0] || {};
  return {
    source: "postgres",
    buyerToSellerMessages: Number(row.buyer_to_seller) || 0,
    uniqueBuyers: Number(row.unique_buyers) || 0,
    uniqueSellers: Number(row.unique_sellers) || 0,
  };
}

function inquiryMetricsFromFiles(sinceMs, untilMs) {
  const orders = listAllOrders().filter((o) => {
    const t = Number(o.createdAt) || 0;
    return t >= sinceMs && t < untilMs;
  });
  const contacts = getAllContacts().filter((c) => {
    const t = Number(c.lastSeen) || 0;
    return t >= sinceMs && t < untilMs;
  });
  return {
    source: "file_store",
    buyerToSellerMessages: null,
    uniqueBuyers: new Set(orders.map((o) => phoneOfOrder(o) || o.customerKey).filter(Boolean)).size,
    uniqueSellers: new Set(orders.map((o) => o.shopHandle || o.supplierId).filter(Boolean)).size,
    ordersInRange: orders.length,
    contactsSeen: contacts.length,
  };
}

export async function getInquiryMetrics({ dateRange } = {}, now = Date.now()) {
  const range = parseDateRange(dateRange, now);
  const sinceIso = new Date(range.sinceMs).toISOString();
  const untilIso = new Date(range.untilMs).toISOString();
  let metrics = inquiryMetricsFromFiles(range.sinceMs, range.untilMs);
  if (isDbEnabled()) {
    try {
      const db = await inquiryMetricsFromDb(sinceIso, untilIso);
      metrics = { ...metrics, ...db, fileOrdersInRange: metrics.ordersInRange };
    } catch (err) {
      metrics.dbError = String(err?.message || err).slice(0, 160);
    }
  }
  return {
    ok: true,
    tool: "get_inquiry_metrics",
    dateRange: range.label,
    since: sinceIso,
    until: untilIso,
    ...metrics,
  };
}

const RIDER_STATUSES = new Set(["PENDING", "VERIFIED", "SUSPENDED", "REJECTED"]);

export async function getRiderRoster(args = {}) {
  const raw = String(args.status || args.verification_status || args.verificationStatus || "").trim().toUpperCase();
  const status = RIDER_STATUSES.has(raw) ? raw : null;
  if (!isDbEnabled()) {
    return {
      ok: false,
      error: "database_offline",
      tool: "get_rider_roster",
      message: "Rider roster lives in Postgres — the bot is not connected to the database.",
    };
  }
  const { listRiderStatusCounts, listRiders } = await import("./boda-fleet.js");
  const counts = await listRiderStatusCounts();
  if (counts?.error) {
    return {
      ok: false,
      error: "list_failed",
      tool: "get_rider_roster",
      message: String(counts.error).slice(0, 160),
      counts,
    };
  }
  const listed = await listRiders({ status, limit: 12 });
  if (listed?.error && !listed.ok) {
    return {
      ok: false,
      error: listed.error,
      tool: "get_rider_roster",
      message: listed.message || "Could not list riders.",
      counts: listed.counts || counts,
    };
  }
  const riders = (listed.riders || []).slice(0, 12).map((r) => ({
    name: r.fullName || null,
    town: r.operatingTown || null,
    status: r.verificationStatus || null,
    available: Boolean(r.isAvailable),
    fleetStatus: r.fleetStatus || null,
  }));
  const availableVerified = riders.filter((r) => r.status === "VERIFIED" && r.available).length;
  return {
    ok: true,
    tool: "get_rider_roster",
    registered: Number(counts.total) || 0,
    counts,
    filter: status,
    sampleAvailableOnThisPage: availableVerified,
    riders,
  };
}

export async function checkEscrowStatus(args = {}, now = Date.now()) {
  const orderId = args.order_id || args.orderId;
  const phoneNumber = args.phone_number || args.phoneNumber || args.phone;
  const customerName = args.customer_name || args.customerName;
  if (!orderId && !phoneNumber && !String(customerName || "").trim()) {
    return {
      ok: false,
      error: "missing_lookup",
      message: "Need an order id (SKN-…), phone number, or customer name.",
    };
  }
  const orders = findOrdersForOps({ orderId, phoneNumber, customerName });
  if (!orders.length) {
    return {
      ok: false,
      error: "not_found",
      message: "No matching order or customer in escrow.",
    };
  }
  return {
    ok: true,
    tool: "check_escrow_status",
    count: orders.length,
    orders: orders.slice(0, 8).map((o) => escrowSnapshot(o, now)),
  };
}

export async function lookupOrderHistory(args = {}) {
  const orderId = args.order_id || args.orderId;
  const phoneNumber = args.phone_number || args.phoneNumber || args.phone;
  const customerName = args.customer_name || args.customerName;
  const orders = findOrdersForOps({ orderId, phoneNumber, customerName });
  if (!orders.length) {
    return { ok: false, error: "not_found", message: "No order history for that customer." };
  }
  return {
    ok: true,
    tool: "lookup_order_history",
    count: orders.length,
    orders: orders.slice(0, 12).map((o) => ({
      orderId: o.id,
      productName: o.productName || null,
      customerName: nameOfOrder(o) || null,
      phone: phoneOfOrder(o) || null,
      status: o.status || null,
      escrowStatus: o.escrowStatus || null,
      totalKes: o.totalKes ?? o.priceKes ?? null,
      createdAt: o.createdAt || null,
    })),
  };
}

function takeSendSlot(now = Date.now()) {
  sendTimestamps = sendTimestamps.filter((ts) => now - ts < 60 * 1000);
  if (sendTimestamps.length >= SEND_PER_MINUTE) return false;
  sendTimestamps.push(now);
  return true;
}

export function resetOpsSendLimiter() {
  sendTimestamps = [];
}

function knownRecipient(phone) {
  if (!phone) return false;
  const orders = getOrdersForCustomer("", phone);
  if (orders.length) return true;
  return getAllContacts().some((c) => normalizeOpsPhone(c.phone || c.customerKey) === phone);
}

export async function sendWhatsAppMessage(args = {}, extras = {}) {
  const { sender = sendText, now = Date.now(), dryRun = false } = extras;
  const text = String(args.text || args.message || "").trim();
  let phone = normalizeOpsPhone(args.phone || args.phone_number || args.phoneNumber);
  const orderId = args.order_id || args.orderId;

  if (!phone && orderId) {
    const order = getOrder(orderId);
    phone = phoneOfOrder(order);
  }
  if (!phone) {
    return { ok: false, error: "missing_phone", message: "Need a Kenya WhatsApp number or an order id with a saved phone." };
  }
  if (!/^2547\d{8}$/.test(phone) && !/^2541\d{8}$/.test(phone)) {
    return { ok: false, error: "invalid_phone", message: "That does not look like a Kenya mobile number." };
  }
  if (!text) {
    return { ok: false, error: "missing_text", message: "Message text is required." };
  }
  if (text.length > SEND_MAX_CHARS) {
    return { ok: false, error: "text_too_long", message: `Keep WhatsApp notes under ${SEND_MAX_CHARS} characters.` };
  }
  if (!extras.allowUnknown && !knownRecipient(phone)) {
    return {
      ok: false,
      error: "unknown_recipient",
      message: "Can only message a number that already has a Sokoni order or WhatsApp chat.",
    };
  }
  if (!takeSendSlot(now)) {
    return { ok: false, error: "rate_limited", message: "Too many WhatsApp sends this minute — try again shortly." };
  }

  const chatId = toChatId(phone);
  const forceDry = dryRun || !config.waha?.apiUrl;
  if (forceDry) {
    return {
      ok: true,
      tool: "send_whatsapp_message",
      dryRun: true,
      phone,
      chatId,
      text,
      message: "WAHA dry-run — message logged, not sent.",
    };
  }

  try {
    const resp = await sender(chatId, text, { timeoutMs: 12_000 });
    try {
      const { writeAdminLog } = await import("./admin-logs.js");
      await writeAdminLog({
        action: "OPS_AGENT_WHATSAPP",
        actorLabel: "ops-agent",
        orderRef: orderId || null,
        targetType: "whatsapp",
        targetId: phone,
        source: "ops-agent.send_whatsapp_message",
        success: true,
        message: text.slice(0, 180),
      });
    } catch {
      /* fail-soft */
    }
    return {
      ok: true,
      tool: "send_whatsapp_message",
      dryRun: Boolean(resp?.dryRun || resp?.captured),
      phone,
      chatId,
      text,
      message: resp?.dryRun ? "WAHA dry-run." : "WhatsApp sent.",
    };
  } catch (err) {
    return {
      ok: false,
      error: "send_failed",
      message: String(err?.message || err).slice(0, 200),
    };
  }
}

export async function executeOpsTool(name, rawArgs = {}, extras = {}) {
  const tool = String(name || "").trim();
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};
  try {
    if (tool === "get_inquiry_metrics") return await getInquiryMetrics({ dateRange: args.date_range || args.dateRange }, extras.now);
    if (tool === "get_rider_roster") return await getRiderRoster(args);
    if (tool === "check_escrow_status") return await checkEscrowStatus(args, extras.now);
    if (tool === "lookup_order_history") return await lookupOrderHistory(args);
    if (tool === "send_whatsapp_message") return await sendWhatsAppMessage(args, extras);
    return { ok: false, error: "unknown_tool", message: `Tool "${tool}" is not allowed.` };
  } catch (err) {
    return {
      ok: false,
      error: "tool_crashed",
      tool,
      message: String(err?.message || err).slice(0, 200),
    };
  }
}
