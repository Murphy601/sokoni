/**
 * Read-only ops desk tools — platform counts, escrow tank, disputes, catalog, CRM.
 * No payout / release / refund mutations. Never returns till numbers.
 */
import { listAllOrders, getOrder } from "./orders.js";
import { normalizeKenyaPhone } from "../lib/phone-normalize.js";
import { getEscrowHoldingTank, getPlatformCommandDashboard } from "./platform-command.js";

const HOUR_MS = 60 * 60 * 1000;

function parseRange(raw, now = Date.now()) {
  const key = String(raw || "all")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (!key || key === "all" || key === "ever") {
    return { label: "all", sinceMs: 0, untilMs: now };
  }
  const map = {
    today: 24 * HOUR_MS,
    "24h": 24 * HOUR_MS,
    "7d": 7 * 24 * HOUR_MS,
    week: 7 * 24 * HOUR_MS,
    "30d": 30 * 24 * HOUR_MS,
    month: 30 * 24 * HOUR_MS,
  };
  const ms = map[key] ?? (/^\d+d$/.test(key) ? Number.parseInt(key, 10) * 24 * HOUR_MS : 7 * 24 * HOUR_MS);
  const clamped = Math.min(365 * 24 * HOUR_MS, Math.max(HOUR_MS, ms));
  return { label: key in map ? key : `${Math.round(clamped / (24 * HOUR_MS))}d`, sinceMs: now - clamped, untilMs: now };
}

export function getOrderMetrics({ dateRange } = {}, now = Date.now()) {
  const range = parseRange(dateRange, now);
  const all = listAllOrders().filter((o) => o.kind !== "cart_child");
  const scoped = range.sinceMs
    ? all.filter((o) => {
        const t = Number(o.createdAt) || 0;
        return t >= range.sinceMs && t < range.untilMs;
      })
    : all;
  const byStatus = {};
  let paid = 0;
  let heldEscrow = 0;
  let volumeKes = 0;
  for (const o of scoped) {
    const s = String(o.status || "unknown");
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (o.paidAt || o.customerPaymentStatus === "confirmed") paid += 1;
    const escrow = String(o.escrowStatus || "").toLowerCase();
    if (escrow === "held" || o.disputeHold || o.escrowPaused) heldEscrow += 1;
    volumeKes += Number(o.totalKes ?? o.buyerTotalKes ?? o.priceKes) || 0;
  }
  return {
    ok: true,
    tool: "get_order_metrics",
    total: all.length,
    inRange: scoped.length,
    dateRange: range.label,
    paidCount: paid,
    heldEscrowCount: heldEscrow,
    volumeKes: Math.round(volumeKes),
    byStatus,
  };
}

export function listPendingEscrow({ limit = 20 } = {}) {
  const cap = Math.min(40, Math.max(1, Number(limit) || 20));
  const tank = getEscrowHoldingTank({ limit: cap });
  const rows = (tank.orders || []).slice(0, cap).map((row) => {
    const order = getOrder(row.orderId);
    return {
      orderId: row.orderId,
      productName: row.productName,
      customerName: row.customerName || null,
      phone: normalizeKenyaPhone(order?.phone || order?.mpesaPhone || order?.customerKey) || null,
      buyerTotalKes: row.buyerTotalKes,
      status: row.status,
      escrowStatus: row.escrowStatus,
      delivered: row.delivered,
      disputeHold: row.disputeHold,
      escrowPaused: row.escrowPaused,
      deliveryLabel: row.deliveryLabel,
    };
  });
  return {
    ok: true,
    tool: "list_pending_escrow",
    totals: tank.totals || {},
    count: rows.length,
    heldOrders: tank.totals?.heldOrders ?? rows.length,
    orders: rows,
  };
}

export async function getPlatformSnapshot() {
  const dash = await getPlatformCommandDashboard();
  const tank = dash.escrow || {};
  return {
    ok: true,
    tool: "get_platform_snapshot",
    ordersHeld: tank.totals?.heldOrders || 0,
    heldBuyerKes: tank.totals?.heldBuyerKes || 0,
    pausedCount: tank.totals?.pausedCount || 0,
    disputeHoldCount: tank.totals?.disputeHoldCount || 0,
    openDisputes: dash.disputes?.openCount || 0,
    settlementFailedCount: tank.totals?.settlementFailedCount || 0,
    generatedAt: dash.generatedAt || Date.now(),
  };
}

export async function listOpenDisputes({ status = "open", limit = 20 } = {}) {
  try {
    const { listAdminDisputes } = await import("./disputes.js");
    const listed = await listAdminDisputes({ status, limit: Math.min(40, Number(limit) || 20) });
    if (listed.error) {
      return { ok: false, tool: "list_open_disputes", error: listed.error, message: listed.message, disputes: [] };
    }
    const disputes = (listed.disputes || []).slice(0, 20).map((d) => ({
      id: d.id,
      orderId: d.order_id || d.orderId || d.order_ref,
      status: d.status,
      reason: d.reason || d.buyer_reason || null,
      createdAt: d.created_at || d.createdAt,
    }));
    return {
      ok: true,
      tool: "list_open_disputes",
      count: listed.count ?? disputes.length,
      disputes,
    };
  } catch (err) {
    return {
      ok: false,
      tool: "list_open_disputes",
      error: "list_failed",
      message: String(err.message || err).slice(0, 160),
      disputes: [],
    };
  }
}

export function listOrders({ status, dateRange, limit = 40 } = {}, now = Date.now()) {
  const cap = Math.min(80, Math.max(1, Number(limit) || 40));
  const range = parseRange(dateRange, now);
  const want = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  let rows = listAllOrders().filter((o) => o.kind !== "cart_child");
  if (range.sinceMs) {
    rows = rows.filter((o) => {
      const t = Number(o.createdAt) || 0;
      return t >= range.sinceMs && t < range.untilMs;
    });
  }
  if (want && want !== "all") {
    rows = rows.filter((o) => {
      const s = String(o.status || "").toLowerCase();
      const e = String(o.escrowStatus || "").toLowerCase();
      if (s === want || e === want) return true;
      if (want === "held" || want === "escrow") return e === "held" || o.disputeHold || o.escrowPaused;
      if (want === "paid") return Boolean(o.paidAt || o.customerPaymentStatus === "confirmed");
      return false;
    });
  }
  rows.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  const orders = rows.slice(0, cap).map((o) => ({
    orderId: o.id,
    status: o.status || null,
    escrowStatus: o.escrowStatus || null,
    productName: o.productName || null,
    customerName: o.customerName || null,
    phone: normalizeKenyaPhone(o.phone || o.mpesaPhone || o.customerKey) || null,
    totalKes: Number(o.totalKes ?? o.buyerTotalKes ?? o.priceKes) || 0,
    createdAt: o.createdAt || null,
  }));
  return {
    ok: true,
    tool: "list_orders",
    count: rows.length,
    showing: orders.length,
    status: want || "all",
    dateRange: range.label,
    orders,
  };
}

export async function searchCatalog({ keywords, q, query, max_price, maxPrice, limit = 8 } = {}) {
  const { searchProducts } = await import("./catalog.js");
  const hits = await searchProducts({
    keywords: keywords || q || query,
    limit: Math.min(12, Math.max(1, Number(limit) || 8)),
  });
  const capPrice = Number(max_price ?? maxPrice);
  let products = (hits || []).slice(0, 8).map((p) => ({
    id: p.id,
    name: p.name,
    priceKes: p.priceKes,
    category: p.category || null,
    shop: p.shopHandle || p.sellerHandle || null,
    inStock: p.inStock !== false && !p.isSold,
  }));
  if (Number.isFinite(capPrice) && capPrice > 0) {
    products = products.filter((p) => Number(p.priceKes) <= capPrice);
  }
  return { ok: true, tool: "search_catalog", count: products.length, products };
}

export async function listCrmDirectory({ tag, q, window = "any", limit = 20 } = {}, extras = {}) {
  const { listCrmContacts, syncCrmFromRosters } = await import("./whatsapp-crm.js");
  const synced = await syncCrmFromRosters(extras);
  const rows = listCrmContacts({ tag, q, window, limit: Math.min(40, Number(limit) || 20) });
  return {
    ok: true,
    tool: "list_crm_contacts",
    count: rows.length,
    synced: synced.cached
      ? { cached: true }
      : { riders: synced.riders || 0, sellers: synced.sellers || 0, buyers: synced.buyers || 0 },
    contacts: rows.map((c) => ({
      name: c.displayName || null,
      phone: c.phone || null,
      tag: c.tag || null,
      tags: Array.isArray(c.tags) ? c.tags : [],
      windowOpen: Boolean(c.serviceWindow?.open),
    })),
  };
}
