/**
 * Executive briefings + high-value escrow alerts → ADMIN WhatsApp.
 */
import { config } from "../config.js";
import { getPlatformCommandDashboard } from "./platform-command.js";
import { isDbEnabled, query } from "../db/pool.js";

const BOSS_TITLE = () =>
  String(process.env.ADMIN_BOSS_TITLE || config.contact?.founderName || "Boss")
    .split(/\s+/)[0]
    .slice(0, 40) || "Boss";

export function highValueEscrowThresholdKes() {
  const n = Number(process.env.BOSS_HIGH_VALUE_ALERT_KES || 50000);
  return Number.isFinite(n) && n > 0 ? n : 50000;
}

export function briefingHourEat() {
  const n = Number(process.env.BOSS_BRIEFING_HOUR_EAT ?? 8);
  return Number.isFinite(n) ? Math.min(23, Math.max(0, Math.floor(n))) : 8;
}

async function countAvailableRiders() {
  if (!isDbEnabled()) return null;
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM riders
        WHERE verification_status = 'VERIFIED' AND is_available = TRUE`
    );
    return rows[0]?.n ?? 0;
  } catch {
    return null;
  }
}

/** Compose plain WhatsApp executive briefing text. */
export async function composeExecutiveBriefing() {
  const title = BOSS_TITLE();
  const dash = await getPlatformCommandDashboard();
  const escrow = dash.escrow || {};
  const totals = escrow.totals || {};
  const held = Math.round(Number(totals.heldBuyerKes) || Number(escrow.heldBuyerKes) || 0);
  const openOrders = Number(totals.heldOrders) || (Array.isArray(escrow.orders) ? escrow.orders.length : 0) || (Array.isArray(escrow.rows) ? escrow.rows.length : 0);
  const disputeOpen = dash.disputes?.openCount || Number(totals.disputeHoldCount) || 0;
  const riders = await countAvailableRiders();
  const failedPayouts = Number(totals.settlementFailedCount) || 0;

  const lines = [
    `Good morning, ${title} 🫡. Here is today's Sokoni status:`,
    ``,
    `• *Escrow volume:* KES ${held.toLocaleString()} held across *${openOrders}* active orders.`,
    riders != null
      ? `• *Active riders:* ${riders} online (verified + AVAILABLE).`
      : `• *Active riders:* (DB offline — check Command Center).`,
    `• *System health:* ${failedPayouts} failed payouts · ${disputeOpen} open dispute(s)${
      disputeOpen ? " needing review." : "."
    }`,
    totals.pausedCount
      ? `• *Paused escrow:* ${totals.pausedCount} order(s).`
      : null,
    ``,
    `_Portal:_ sokonimall.com/admin-command.html`,
    `_Reply *!brief* anytime for a refresh._`,
  ].filter(Boolean);
  return lines.join("\n");
}

export async function sendExecutiveBriefingToAdmins() {
  const { sendTextReliable } = await import("./whatsapp.js");
  const text = await composeExecutiveBriefing();
  const admins = [
    ...new Set(
      [...(config.admin.phones || []), config.admin.primary]
        .map((p) => String(p || "").replace(/\D/g, ""))
        .filter((p) => p.length >= 9)
    ),
  ];
  let sent = 0;
  for (const admin of admins) {
    try {
      const r = await sendTextReliable(admin, text, { label: "ExecBriefing" });
      if (r?.ok) sent += 1;
    } catch (err) {
      console.warn("[exec-briefing] send failed:", admin, err.message);
    }
  }
  return { ok: sent > 0, sent, text };
}

/**
 * Real-time high-value escrow ping (call after payment confirmed).
 */
export async function maybeAlertHighValueEscrow(order) {
  if (!order) return { skipped: true };
  const threshold = highValueEscrowThresholdKes();
  const total =
    Number(order.buyerTotalKes) ||
    Number(order.priceKes) + Number(order.shippingKes || 0) ||
    Number(order.priceKes) ||
    0;
  if (total < threshold) return { skipped: true, reason: "below_threshold", total, threshold };

  const { sendTextReliable } = await import("./whatsapp.js");
  const title = BOSS_TITLE();
  const msg =
    `⚡ *High-value escrow, ${title}*\n\n` +
    `• *Order:* *${order.id}*\n` +
    `• *Amount:* KES ${Math.round(total).toLocaleString()} (threshold KES ${threshold.toLocaleString()})\n` +
    `• *Buyer:* ${order.phone || order.customerName || "—"}\n` +
    `• *Product:* ${order.productName || "—"}\n\n` +
    `Funds held in escrow. Portal: sokonimall.com/admin-command.html`;

  const admins = [
    ...new Set(
      [...(config.admin.phones || []), config.admin.primary]
        .map((p) => String(p || "").replace(/\D/g, ""))
        .filter((p) => p.length >= 9)
    ),
  ];
  for (const admin of admins) {
    try {
      await sendTextReliable(admin, msg, { label: "HighValueEscrow" });
    } catch (err) {
      console.warn("[exec-briefing] HV alert failed:", err.message);
    }
  }
  return { ok: true, total, threshold };
}

/** Stale open-dispute nag (optional cron). */
export async function alertStaleOpenDisputes({ olderThanMinutes = 30 } = {}) {
  try {
    const { listAdminDisputes } = await import("./disputes.js");
    const listed = await listAdminDisputes({ status: "open", limit: 30 });
    const disputes = listed.disputes || [];
    const cutoff = Date.now() - olderThanMinutes * 60 * 1000;
    const stale = disputes.filter((d) => {
      const t = new Date(d.created_at || d.createdAt || 0).getTime();
      return t && t < cutoff;
    });
    if (!stale.length) return { ok: true, alerted: 0 };

    const { sendTextReliable } = await import("./whatsapp.js");
    const title = BOSS_TITLE();
    const lines = stale.slice(0, 5).map((d) => {
      const oid = d.order_id || d.orderId || d.order_ref || "—";
      return `• *${oid}* — open >${olderThanMinutes}m`;
    });
    const msg =
      `⏳ *Stale disputes, ${title}*\n\n` +
      `${lines.join("\n")}\n\n` +
      `Reply on a dispute alert with *1* / *2* / *3* or open the portal.`;

    const admins = [
      ...new Set(
        [...(config.admin.phones || []), config.admin.primary]
          .map((p) => String(p || "").replace(/\D/g, ""))
          .filter((p) => p.length >= 9)
      ),
    ];
    for (const admin of admins) {
      await sendTextReliable(admin, msg, { label: "StaleDispute" });
    }
    return { ok: true, alerted: stale.length };
  } catch (err) {
    console.warn("[exec-briefing] stale disputes:", err.message);
    return { ok: false, error: err.message };
  }
}
