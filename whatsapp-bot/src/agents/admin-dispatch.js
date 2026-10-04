/**
 * Deterministic commands for the admin's own WhatsApp.
 *
 * Numbers come from the platform snapshot, the approval queue, or an order.
 * There is no model call on this path, so a missing row stays missing.
 */

import { normalizeKenyaPhone } from "../lib/phone-normalize.js";
import { platformState } from "./platform-state.js";
import { orderAmountKes } from "./admin-notifier.js";

const MISSING = "I do not have that record available. Please provide an order ID or phone number.";

export function adminCommandIndex() {
  return (
    `🤖 *SOKONI ADMIN COMMANDS*\n` +
    `1️⃣ *stats* — memory, active users, and today's KES\n` +
    `2️⃣ *pending* — open escrow and checkout approvals\n` +
    `3️⃣ *A <id>* or *R <id>* — approve or reject one\n` +
    `4️⃣ *user <phone>* — rating and completed orders\n` +
    `5️⃣ *escrow <id>* — lock status for one order`
  );
}

/** A command this desk understands, or null when the admin is just shopping. */
export function matchAdminDispatch(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^(?:\/)?admin\b/i, "").trim();
  const body = stripped === raw ? raw : stripped;
  const lower = body.toLowerCase().replace(/\s+/g, " ");

  if (!body) return { kind: "menu" };
  if (/^(stats|volume|heap|pulse)$/.test(lower)) return { kind: "stats" };
  if (/^(pending|actions|queue)$/.test(lower)) return { kind: "pending" };
  if (/^(dashboard|sysinfo|ops|commands)$/.test(lower)) return { kind: "menu" };
  if (lower.length <= 80 && /\b(how are we|platform pulse|today'?s volume)\b/.test(lower)) {
    return { kind: "stats" };
  }

  const action = lower.match(/^(a|approve|r|reject)\s+(\d+)\s*[.!]?\s*$/);
  if (action) {
    const word = action[1];
    return { kind: "resolve", approve: word === "a" || word === "approve", id: Number(action[2]) };
  }

  const user = body.match(/^user\s+(\+?[\d][\d\s-]{7,18})$/i);
  if (user) return { kind: "user", phone: user[1] };

  const order = body.match(/^(?:escrow|order)\s+([A-Za-z0-9-]{3,40})$/i);
  if (order) return { kind: "order", orderId: order[1] };

  if (stripped !== raw) return { kind: "menu", original: raw };
  return null;
}

async function defaultQuery(sql, params) {
  const { isDbEnabled, query } = await import("../db/pool.js");
  if (!isDbEnabled()) return { rows: [] };
  return query(sql, params);
}

async function defaultLookupUser(phone) {
  const { isDbEnabled, query } = await import("../db/pool.js");
  if (!isDbEnabled()) return null;
  const intl = normalizeKenyaPhone(phone);
  if (!intl) return null;
  const national = intl.startsWith("254") && intl.length > 3 ? `0${intl.slice(3)}` : intl;
  const { rows } = await query(
    `SELECT id, display_name, role, rating_score, rating_count, completed_orders, created_at
     FROM users
     WHERE phone = $1 OR phone = $2
     LIMIT 1`,
    [intl, national]
  );
  return rows[0] || null;
}

function formatUser(row) {
  if (!row) return MISSING;
  const rating = Number(row.rating_score);
  const ratingLine = Number.isFinite(rating) ? `${rating.toFixed(2)} / 5` : "no rating yet";
  const joined = row.created_at
    ? new Date(row.created_at).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" })
    : "—";
  return (
    `👤 *USER*\n` +
    `• ID: ${row.id}\n` +
    `• Name: ${row.display_name || "—"}\n` +
    `• Role: ${row.role || "buyer"}\n` +
    `• Rating: ${ratingLine} (${Number(row.rating_count) || 0} ratings)\n` +
    `• Completed orders: ${Number(row.completed_orders) || 0}\n` +
    `• Joined: ${joined}`
  );
}

function formatOrder(order, amountKes) {
  if (!order) return MISSING;
  const inspection = Number(order.inspectionStartedAt);
  const inspectionLine = Number.isFinite(inspection) && inspection > 0
    ? new Date(inspection).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })
    : "not started";
  const amount = amountKes == null ? "—" : `KES ${Math.round(amountKes).toLocaleString("en-KE")}`;
  return (
    `📦 *ORDER ${order.id}*\n` +
    `• Status: ${order.status || "—"}\n` +
    `• Escrow: ${order.escrowStatus || "—"}\n` +
    `• Payment: ${order.customerPaymentStatus || "—"}\n` +
    `• Buyer total: ${amount}\n` +
    `• Paid out: ${order.isPaidOut ? "yes" : "no"}\n` +
    `• Inspection started: ${inspectionLine}`
  );
}

/**
 * Run one admin command. Returns null when the text is not a desk command,
 * so a normal shop message can continue.
 */
export async function handleAdminDispatch(text, deps = {}) {
  const cmd = matchAdminDispatch(text);
  if (!cmd) return null;
  const snapshot = deps.snapshot || (() => platformState.getSnapshot());
  const query = deps.query || defaultQuery;
  const lookupUser = deps.lookupUser || defaultLookupUser;
  const getOrderById = deps.getOrderById;
  const amountFor = deps.amountFor || orderAmountKes;
  const resolve = deps.resolve || (async (id, decision) => {
    const { resolveAgentAction } = await import("./agent-actions.js");
    return resolveAgentAction(id, decision);
  });

  try {
    if (cmd.kind === "menu") {
      const heard = cmd.original ? `I processed: "${String(cmd.original).slice(0, 80)}"\n\n` : "";
      return `${heard}${adminCommandIndex()}`;
    }

    if (cmd.kind === "stats") {
      const snap = snapshot() || {};
      let pending = "unavailable";
      try {
        const res = await query(
          `SELECT COUNT(*)::int AS pending_approvals
           FROM pending_agent_actions
           WHERE status = 'PENDING' AND expires_at > NOW()`
        );
        const n = res?.rows?.[0]?.pending_approvals;
        if (n != null) pending = String(n);
      } catch (err) {
        console.warn("[admin-dispatch] pending count skipped:", err?.message || err);
      }
      const heap = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
      const today = Number(snap.todayVolumeKes) || 0;
      return (
        `📊 *SOKONI REAL-TIME PULSE*\n` +
        `• Active users: ${snap.activeUsers ?? 0}\n` +
        `• Heap: ${heap}MB / 450MB\n` +
        `• Today's held KES: KES ${Math.round(today).toLocaleString("en-KE")}\n` +
        `• In-flight escrows: ${snap.pendingEscrows ?? 0}\n` +
        `• Pending approvals: ${pending}\n\n` +
        `Reply *pending* to inspect open actions.`
      );
    }

    if (cmd.kind === "pending") {
      const res = await query(
        `SELECT id, action_type, order_id, reason
         FROM pending_agent_actions
         WHERE status = 'PENDING' AND expires_at > NOW()
         ORDER BY created_at ASC
         LIMIT 5`
      );
      const rows = res?.rows || [];
      if (!rows.length) return `✅ *No pending actions in queue.* The platform is running on its own.`;
      let msg = `🚨 *PENDING AGENT ACTIONS (${rows.length})*\n\n`;
      for (const row of rows) {
        const amount = amountFor(row.order_id);
        const kes = amount == null ? "—" : Math.round(amount).toLocaleString("en-KE");
        msg += `🔹 *ID:* ${row.id} | *Type:* ${row.action_type}\n`;
        msg += `   Order ${row.order_id} | KES ${kes}\n`;
        msg += `   ${row.reason || "Needs a decision"}\n`;
        msg += `   Reply *A ${row.id}* to approve or *R ${row.id}* to reject\n\n`;
      }
      return msg.trim();
    }

    if (cmd.kind === "resolve") {
      const result = await resolve(cmd.id, cmd.approve ? "APPROVE" : "REJECT");
      if (!result?.ok) {
        if (result?.error === "not_found" || result?.error === "expired" || result?.error === "already_resolved") {
          return `Action ${cmd.id} is not open. ${result.message || ""}`.trim();
        }
        return `Action ${cmd.id} could not be completed.\n\n${adminCommandIndex()}`;
      }
      const orderId = result.action?.orderId ? ` Order ${result.action.orderId}.` : "";
      if (cmd.approve) {
        return `✅ *APPROVED* action ${cmd.id}.${orderId} The payout check ran.`;
      }
      return `❌ *REJECTED* action ${cmd.id}.${orderId} It will not run.`;
    }

    if (cmd.kind === "user") {
      const row = await lookupUser(cmd.phone);
      return formatUser(row);
    }

    if (cmd.kind === "order") {
      const { getOrder } = await import("../services/orders.js");
      const read = getOrderById || getOrder;
      const order = read(cmd.orderId);
      return formatOrder(order, order ? amountFor(order.id) : null);
    }
  } catch (err) {
    console.error("[admin-dispatch]", err?.message || err);
    return `Something went wrong running that command.\n\n${adminCommandIndex()}`;
  }

  return adminCommandIndex();
}
