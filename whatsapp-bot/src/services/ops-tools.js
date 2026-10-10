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
  "get_seller_roster",
  "get_rider_roster",
  "search_store_policies",
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

function matchNeedle(hay, needle) {
  const want = String(needle || "").trim().toLowerCase();
  if (!want) return true;
  return String(hay || "").toLowerCase().includes(want);
}

function sellerRecord(s, source) {
  const phone = normalizeOpsPhone(s.phone || s.mpesaNumber || s.whatsappChatId || "");
  return {
    name: s.contactName || s.displayName || s.display_name || s.businessName || s.shopName || s.shop_name || null,
    shop: s.businessName || s.business_name || s.shopName || s.shop_name || s.shopHandle || s.handle || null,
    phone: phone || null,
    email: s.email || null,
    city: s.city || s.location || null,
    verified: Boolean(s.is_verified || s.isSellerVerified || s.is_seller_verified),
    source,
  };
}

async function sellersFromDb(limit = 80) {
  if (!isDbEnabled()) return [];
  try {
    const { rows } = await query(
      `SELECT u.phone, u.email, u.display_name, u.handle, u.shop_name, u.location,
              s.business_name, s.city, s.is_verified
         FROM users u
         LEFT JOIN sellers s ON s.user_id = u.id
        WHERE u.role = 'seller' OR s.id IS NOT NULL
        ORDER BY u.id DESC
        LIMIT $1`,
      [Math.max(1, Math.min(200, limit))]
    );
    return (rows || []).map((row) =>
      sellerRecord(
        {
          phone: row.phone,
          email: row.email,
          displayName: row.display_name,
          handle: row.handle,
          shopName: row.shop_name,
          location: row.location,
          businessName: row.business_name,
          city: row.city,
          is_verified: row.is_verified,
        },
        "postgres"
      )
    );
  } catch (err) {
    console.warn("[ops-tools] seller db list skipped:", err.message);
    return [];
  }
}

export async function getSellerRoster(args = {}) {
  const q = String(args.q || args.name || args.shop || "").trim();
  const limit = Math.max(1, Math.min(80, Number(args.limit) || 40));
  const merged = [];
  const seen = new Set();
  const take = (row) => {
    if (!row) return;
    const key = row.phone || `${row.shop || ""}:${row.name || ""}`.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(row);
  };

  try {
    const { listSuppliers } = await import("./suppliers.js");
    for (const s of listSuppliers() || []) take(sellerRecord(s, "file"));
  } catch (err) {
    console.warn("[ops-tools] seller file list skipped:", err.message);
  }
  for (const row of await sellersFromDb(200)) take(row);

  const filtered = q
    ? merged.filter((row) => matchNeedle([row.name, row.shop, row.phone, row.email, row.city].join(" "), q))
    : merged;

  return {
    ok: true,
    tool: "get_seller_roster",
    registered: merged.length,
    matched: filtered.length,
    filter: q || null,
    sellers: filtered.slice(0, limit),
    note: "Admin-only. Name + registered WhatsApp. send_whatsapp_message can reach these phones.",
  };
}

export async function getRiderRoster(args = {}) {
  const raw = String(args.status || args.verification_status || args.verificationStatus || "").trim().toUpperCase();
  const status = RIDER_STATUSES.has(raw) ? raw : null;
  const q = String(args.q || args.name || "").trim();
  const limit = Math.max(1, Math.min(80, Number(args.limit) || (q ? 40 : 40)));
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
  const listed = await listRiders({ status, q: q || null, limit });
  if (listed?.error && !listed.ok) {
    return {
      ok: false,
      error: listed.error,
      tool: "get_rider_roster",
      message: listed.message || "Could not list riders.",
      counts: listed.counts || counts,
    };
  }
  const riders = (listed.riders || []).slice(0, limit).map((r) => ({
    name: r.fullName || null,
    phone: normalizeOpsPhone(r.phone) || r.phone || null,
    town: r.operatingTown || null,
    status: r.verificationStatus || null,
    available: Boolean(r.isAvailable),
    fleetStatus: r.fleetStatus || null,
  }));
  const availableVerified = riders.filter((r) => r.status === "VERIFIED" && r.available).length;
  return {
    ok: true,
    tool: "get_rider_roster",
    registered: Number(counts.total) || riders.length,
    counts,
    filter: status || q || null,
    sampleAvailableOnThisPage: availableVerified,
    riders,
    note: "Admin-only. Name + registered WhatsApp. send_whatsapp_message can reach these phones.",
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

function phoneMatches(a, b) {
  const x = normalizeOpsPhone(a);
  const y = normalizeOpsPhone(b);
  if (!x || !y) return false;
  return x === y || x.slice(-9) === y.slice(-9);
}

async function isDirectoryPhone(phone) {
  if (!phone) return false;
  try {
    const { findSupplierByPhone, listSuppliers } = await import("./suppliers.js");
    if (findSupplierByPhone(phone)) return true;
    if ((listSuppliers() || []).some((s) => phoneMatches(s.phone, phone) || phoneMatches(s.mpesaNumber, phone))) {
      return true;
    }
  } catch {
    /* ignore */
  }
  if (!isDbEnabled()) return false;
  const tail = `%${String(phone).replace(/\D/g, "").slice(-9)}`;
  try {
    const riders = await query(
      `SELECT 1 FROM riders WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE $1 LIMIT 1`,
      [tail]
    );
    if (riders.rows?.length) return true;
  } catch {
    /* ignore */
  }
  try {
    const users = await query(
      `SELECT 1 FROM users
        WHERE role = 'seller'
          AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE $1
        LIMIT 1`,
      [tail]
    );
    if (users.rows?.length) return true;
  } catch {
    /* ignore */
  }
  return false;
}

async function knownRecipient(phone) {
  if (!phone) return false;
  const orders = getOrdersForCustomer("", phone);
  if (orders.length) return true;
  if (getAllContacts().some((c) => phoneMatches(c.phone || c.customerKey, phone))) return true;
  return isDirectoryPhone(phone);
}

async function resolveDirectoryPhone(args = {}) {
  let phone = normalizeOpsPhone(args.phone || args.phone_number || args.phoneNumber);
  if (phone) return phone;
  const sellerName = String(args.seller_name || args.sellerName || "").trim();
  const riderName = String(args.rider_name || args.riderName || "").trim();
  const name = String(args.name || "").trim();
  const role = String(args.role || "").trim().toLowerCase();

  if (sellerName || role === "seller") {
    const roster = await getSellerRoster({ q: sellerName || name, limit: 5 });
    const hit = roster.sellers?.find((s) => s.phone);
    if (hit?.phone) return hit.phone;
  }
  if (riderName || role === "rider") {
    const roster = await getRiderRoster({ q: riderName || name, limit: 5 });
    const hit = roster.riders?.find((r) => r.phone);
    if (hit?.phone) return hit.phone;
  }
  if (name) {
    const sellers = await getSellerRoster({ q: name, limit: 3 });
    if (sellers.sellers?.[0]?.phone) return sellers.sellers[0].phone;
    const riders = await getRiderRoster({ q: name, limit: 3 });
    if (riders.riders?.[0]?.phone) return riders.riders[0].phone;
  }
  return "";
}

export async function sendWhatsAppMessage(args = {}, extras = {}) {
  const { sender = sendText, now = Date.now(), dryRun = false } = extras;
  const text = String(args.text || args.message || "").trim();
  const orderId = args.order_id || args.orderId;
  let phone = await resolveDirectoryPhone(args);

  if (!phone && orderId) {
    const order = getOrder(orderId);
    phone = phoneOfOrder(order);
  }
  if (!phone) {
    return {
      ok: false,
      error: "missing_phone",
      message: "Need a Kenya WhatsApp number, a seller/rider name, or an order id with a saved phone.",
    };
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
  if (!extras.allowUnknown && !(await knownRecipient(phone))) {
    return {
      ok: false,
      error: "unknown_recipient",
      message: "Can only message a registered seller, rider, or a number that already has a Sokoni order or chat.",
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
    if (tool === "get_seller_roster") return await getSellerRoster(args);
    if (tool === "get_rider_roster") return await getRiderRoster(args);
    if (tool === "search_store_policies") {
      const { searchStorePolicies } = await import("./knowledge-rag.js");
      return searchStorePolicies(args.query || args.question || args.q, {
        limit: args.limit,
        minSimilarity: args.min_similarity || args.minSimilarity,
      });
    }
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
