/**
 * Gated actions. An agent may ask. Only an admin approval runs one, and the
 * runner is the existing payout or checkout function, which still applies its
 * own checks. The agent does not supply an amount or a phone.
 */

import { isDbEnabled, query } from "../db/pool.js";
import { normalizeOrderId } from "../lib/order-id.js";

const ACTIONS = new Set(["RELEASE_ESCROW", "PROMPT_STK"]);
const LIST_STATUSES = new Set([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "FAILED",
  "EXPIRED",
  "FAILED_DUE_TO_DISPUTE",
]);
const ACTION_COLUMNS = `id, action_type, order_id, reason, agent_name, status, result_code, created_at, resolved_at, expires_at`;

let proposesThisHour = [];

export function normalizeAgentAction(action) {
  const name = String(action || "").toUpperCase();
  return ACTIONS.has(name) ? name : null;
}

function intId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/** skn1002 and SKN-1002 are the same order. */
export function canonicalActionOrderId(value) {
  const normalized = normalizeOrderId(value);
  if (normalized) return normalized.slice(0, 40);
  const id = String(value || "").trim().toUpperCase().slice(0, 40);
  return id || null;
}

function orderIdOf(value) {
  return canonicalActionOrderId(value);
}

function mapRow(row) {
  return {
    id: Number(row.id),
    actionType: row.action_type,
    orderId: row.order_id,
    reason: row.reason || null,
    agentName: row.agent_name,
    status: row.status,
    resultCode: row.result_code || null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || null,
    expiresAt: row.expires_at || null,
  };
}

/** Why a claim that matched zero rows cannot run. */
export function explainUnresolved(row, now = Date.now()) {
  if (!row) return { error: "not_found", message: "Action not found." };
  const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.status === "PENDING" && Number.isFinite(exp) && exp <= now) {
    return { error: "expired", message: "That action expired before it was approved." };
  }
  return {
    error: "already_resolved",
    message: "That action was already resolved.",
    status: row.status,
  };
}

/**
 * Record a proposal. Returns null when the database is down or the hour is
 * already full, so a noisy agent cannot fill the table.
 */
export async function proposeAgentAction({ actionType, orderId, reason = "", agentName = "agent" } = {}) {
  const type = normalizeAgentAction(actionType);
  const order = orderIdOf(orderId);
  if (!type || !order) return { error: "invalid_action", message: "Action and order are required." };
  if (!isDbEnabled()) return { error: "database_not_configured", message: "Database is not configured." };

  const now = Date.now();
  proposesThisHour = proposesThisHour.filter((ts) => now - ts < 60 * 60 * 1000);
  if (proposesThisHour.length >= 20) {
    return { error: "rate_limited", message: "Too many agent proposals this hour." };
  }

  try {
    const { rows } = await query(
      `INSERT INTO pending_agent_actions (action_type, order_id, reason, agent_name, status, expires_at)
       VALUES ($1, $2, $3, $4, 'PENDING', NOW() + INTERVAL '2 hours')
       RETURNING ${ACTION_COLUMNS}`,
      [type, order, String(reason || "").slice(0, 280) || null, String(agentName || "agent").slice(0, 40)]
    );
    proposesThisHour.push(now);
    const action = mapRow(rows[0]);
    void import("./admin-notifier.js")
      .then(({ notifyProposedAction }) => notifyProposedAction(action))
      .catch((err) => console.warn("[agent-actions] notify skipped:", err?.message || err));
    return { ok: true, action };
  } catch (err) {
    if (err?.code === "23505") {
      return { error: "already_open", message: "That order already has this action." };
    }
    throw err;
  }
}

export async function expireStaleActions() {
  if (!isDbEnabled()) return 0;
  const { rowCount } = await query(
    `UPDATE pending_agent_actions
     SET status = 'EXPIRED', result_code = 'expired', resolved_at = NOW()
     WHERE status = 'PENDING' AND expires_at <= NOW()`
  );
  return rowCount || 0;
}

/** True when this order already has a release proposal, in any status. */
export async function queryOpenRelease(orderId) {
  const order = orderIdOf(orderId);
  if (!order || !isDbEnabled()) return false;
  const { rows } = await query(
    `SELECT id FROM pending_agent_actions
     WHERE order_id = $1
       AND action_type = 'RELEASE_ESCROW'
     LIMIT 1`,
    [order]
  );
  return Boolean(rows[0]);
}

export async function listAgentActions(status = "PENDING") {
  const wanted = String(status || "PENDING").toUpperCase();
  if (!LIST_STATUSES.has(wanted)) {
    return {
      error: "invalid_status",
      message: "Status must be PENDING, APPROVED, REJECTED, FAILED, EXPIRED, or FAILED_DUE_TO_DISPUTE.",
    };
  }
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  await expireStaleActions();
  const { rows } = await query(
    `SELECT ${ACTION_COLUMNS}
     FROM pending_agent_actions
     WHERE status = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [wanted]
  );
  return { ok: true, actions: rows.map(mapRow) };
}

async function defaultExecute(row) {
  if (row.action_type === "RELEASE_ESCROW") {
    const { releaseEscrowPayout } = await import("../services/seller-onboard.js");
    return releaseEscrowPayout(row.order_id);
  }
  if (row.action_type === "PROMPT_STK") {
    const { getOrder } = await import("../services/orders.js");
    const { initiateMpesaCheckout } = await import("../services/prepaid-checkout.js");
    const order = getOrder(row.order_id);
    if (!order) return { error: "not_found" };
    const response = await initiateMpesaCheckout(order);
    if (response?.ok !== true) {
      return { error: response?.error || response?.method || "stk_failed", ok: false };
    }
    return response;
  }
  return { error: "unsupported_action" };
}

/**
 * Approve runs the existing function. Reject only closes the row.
 * `execute` is a test seam. Production uses defaultExecute.
 */
export async function resolveAgentAction(actionId, decision, { execute = defaultExecute } = {}) {
  const id = intId(actionId);
  if (!id) return { error: "invalid_action", message: "Action id is required." };
  const choice = String(decision || "").toUpperCase();
  if (choice !== "APPROVE" && choice !== "REJECT") {
    return { error: "unsupported_action", message: "Use APPROVE or REJECT." };
  }
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const nextStatus = choice === "APPROVE" ? "APPROVED" : "REJECTED";
  // Claim the row before any payout or STK call. A second click matches zero rows.
  const claimed = await query(
    `UPDATE pending_agent_actions
     SET status = $2, resolved_at = NOW()
     WHERE id = $1 AND status = 'PENDING' AND expires_at > NOW()
     RETURNING ${ACTION_COLUMNS}`,
    [id, nextStatus]
  );
  const row = claimed.rows[0];
  if (!row) {
    const existing = await query(
      `SELECT ${ACTION_COLUMNS} FROM pending_agent_actions WHERE id = $1`,
      [id]
    );
    const explained = explainUnresolved(existing.rows[0]);
    if (explained.error === "expired") {
      await query(
        `UPDATE pending_agent_actions
         SET status = 'EXPIRED', result_code = 'expired', resolved_at = NOW()
         WHERE id = $1 AND status = 'PENDING'`,
        [id]
      );
    }
    return explained;
  }
  if (choice === "REJECT") return { ok: true, action: mapRow(row) };

  if (row.action_type === "RELEASE_ESCROW" && (await releaseBlockedByDispute(row.order_id))) {
    await markAction(id, "FAILED_DUE_TO_DISPUTE", "dispute_open");
    return {
      ok: false,
      error: "dispute_open",
      action: { ...mapRow(row), status: "FAILED_DUE_TO_DISPUTE", resultCode: "dispute_open" },
      resultCode: "dispute_open",
    };
  }

  let result;
  try {
    result = await execute(row);
  } catch (err) {
    result = { error: "execute_failed", message: err?.message || "failed" };
  }
  const failed = Boolean(result?.error);
  const code = failed ? String(result.error).slice(0, 64) : "ok";
  if (failed) {
    await query(
      `UPDATE pending_agent_actions
       SET status = 'FAILED', result_code = $2
       WHERE id = $1 AND status = 'APPROVED'`,
      [id, code]
    );
  } else {
    await query(
      `UPDATE pending_agent_actions SET result_code = $2 WHERE id = $1`,
      [id, code]
    );
  }
  return {
    ok: !failed,
    action: { ...mapRow(row), status: failed ? "FAILED" : "APPROVED", resultCode: code },
    resultCode: code,
  };
}

async function markAction(id, status, code) {
  try {
    await query(
      `UPDATE pending_agent_actions
       SET status = $2, result_code = $3
       WHERE id = $1`,
      [id, status, code]
    );
  } catch (err) {
    console.warn("[agent-actions] status write fell back:", err?.message || err);
    await query(
      `UPDATE pending_agent_actions
       SET status = 'FAILED', result_code = $2
       WHERE id = $1`,
      [id, code]
    );
  }
}

/** A dispute opened after the proposal still blocks the payout. A lookup failure does too. */
async function releaseBlockedByDispute(orderId) {
  const { getOrder } = await import("../services/orders.js");
  const { orderHasOpenDispute } = await import("../services/disputes.js");
  const order = getOrder(orderId);
  if (!order) return false;
  if (order.disputeHold) return true;
  try {
    return await orderHasOpenDispute(orderId, { strict: true });
  } catch (err) {
    console.warn("[agent-actions] dispute lookup failed, payout aborted:", err?.message || err);
    return true;
  }
}

export function resetActionLimitsForTests() {
  proposesThisHour = [];
}
