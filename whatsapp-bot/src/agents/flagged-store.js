/**
 * Postgres audit for messages the chat screener refused.
 *
 * The row is the review copy. The live thread never receives the text, and
 * list responses do not include contact numbers — the admin token already
 * lives in the browser, and a stolen token should not dump every phone that
 * was shared in a blocked message's neighbouring columns.
 */

import { isDbEnabled, query } from "../db/pool.js";

const VIOLATIONS = new Set([
  "PHONE_NUMBER",
  "OFF_PLATFORM_PAYMENT",
  "EXTERNAL_LINK",
  "CONTACT_DETAILS",
]);

const LIST_STATUSES = new Set(["PENDING", "WARNED", "DISMISSED"]);

export function normalizeResolveAction(action) {
  const name = String(action || "").toUpperCase();
  if (name === "WARN") return "WARNED";
  if (name === "DISMISS") return "DISMISSED";
  return null;
}

function intId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function mapFlag(row) {
  return {
    id: Number(row.id),
    senderUserId: row.sender_user_id == null ? null : Number(row.sender_user_id),
    receiverUserId: row.receiver_user_id == null ? null : Number(row.receiver_user_id),
    senderName: row.sender_name || null,
    senderRole: row.sender_role || null,
    receiverName: row.receiver_name || null,
    content: row.content,
    violationType: row.violation_type,
    status: row.status,
    adminNotes: row.admin_notes || null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || null,
  };
}

/**
 * Insert one audit row. Returns null when the database is down or the reason
 * is not one the screener actually emits — a failed insert must not change
 * the sender's "message blocked" response.
 */
export async function recordFlaggedMessage({
  senderUserId,
  receiverUserId,
  content,
  violationType,
} = {}) {
  if (!isDbEnabled()) return null;
  if (!VIOLATIONS.has(violationType)) {
    console.warn("[flagged] unknown violation:", violationType);
    return null;
  }
  const text = String(content || "").slice(0, 2000);
  if (!text) return null;
  const sender = intId(senderUserId);
  const receiver = intId(receiverUserId);
  try {
    const { rows } = await query(
      `INSERT INTO flagged_messages (sender_user_id, receiver_user_id, content, violation_type, status)
       VALUES ($1, $2, $3, $4, 'PENDING')
       RETURNING id, created_at`,
      [sender, receiver, text, violationType]
    );
    return { id: Number(rows[0].id), createdAt: rows[0].created_at };
  } catch (err) {
    console.warn("[flagged] insert skipped:", err.message);
    return null;
  }
}

export async function listFlaggedMessages(status = "PENDING") {
  const wanted = String(status || "PENDING").toUpperCase();
  if (!LIST_STATUSES.has(wanted)) {
    return { error: "invalid_status", message: "Status must be PENDING, WARNED, or DISMISSED." };
  }
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const { rows } = await query(
    `SELECT f.id, f.sender_user_id, f.receiver_user_id, f.content, f.violation_type,
            f.status, f.admin_notes, f.created_at, f.resolved_at,
            s.display_name AS sender_name, s.role AS sender_role,
            r.display_name AS receiver_name
     FROM flagged_messages f
     LEFT JOIN users s ON s.id = f.sender_user_id
     LEFT JOIN users r ON r.id = f.receiver_user_id
     WHERE f.status = $1
     ORDER BY f.created_at DESC
     LIMIT 50`,
    [wanted]
  );
  return { ok: true, flags: rows.map(mapFlag) };
}

/**
 * WARN or DISMISS a pending flag.
 *
 * WARN tells the sender, through the existing WhatsApp sender, that the
 * message was blocked. It does not quote what they wrote. There is no
 * account-suspended column on users, so this does not pretend to freeze one.
 */
export async function resolveFlaggedMessage(flagId, action, notes = "") {
  const id = intId(flagId);
  if (!id) return { error: "invalid_flag", message: "Flag id is required." };
  const status = normalizeResolveAction(action);
  if (!status) {
    return {
      error: "unsupported_action",
      message: "Use WARN or DISMISS. Shop suspension stays on the seller enforce tools.",
    };
  }
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const note = String(notes || "").slice(0, 500);
  const { rows } = await query(
    `UPDATE flagged_messages
     SET status = $1, admin_notes = $2, resolved_at = NOW()
     WHERE id = $3 AND status = 'PENDING'
     RETURNING id, sender_user_id, status`,
    [status, note || null, id]
  );
  if (!rows[0]) {
    const existing = await query(`SELECT id, status FROM flagged_messages WHERE id = $1`, [id]);
    if (!existing.rows[0]) return { error: "not_found", message: "Flag not found." };
    return {
      error: "already_resolved",
      message: "That flag was already resolved.",
      status: existing.rows[0].status,
    };
  }

  let notified = false;
  if (status === "WARNED" && rows[0].sender_user_id) {
    notified = await warnSender(rows[0].sender_user_id);
  }
  return { ok: true, flaggedId: id, status, notified };
}

async function warnSender(userId) {
  try {
    const { rows } = await query(`SELECT phone FROM users WHERE id = $1`, [userId]);
    const phone = rows[0]?.phone;
    if (!phone) return false;
    const { sendText } = await import("../services/whatsapp.js");
    await sendText(
      phone,
      "⚠️ *Sokoni*\n\nA chat message was blocked because it tried to move the deal off Sokoni. " +
        "Pay inside the app so M-Pesa escrow still covers you."
    );
    return true;
  } catch (err) {
    console.warn("[flagged] warn not delivered:", err?.message || err);
    return false;
  }
}
