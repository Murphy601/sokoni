/**
 * Dedicated admin_logs stream for Boss / ops overrides (FORCE RELEASE, SUSPEND SHOP, …).
 * Fail-soft when Postgres is offline. Also mirrors critical actions into audit_logs.
 */
import { isDbEnabled, query } from "../db/pool.js";
import { writeAuditLog } from "./audit-log.js";

let tableReady = false;

async function ensureAdminLogsTable() {
  if (tableReady || !isDbEnabled()) return;
  await query(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id            BIGSERIAL PRIMARY KEY,
      actor_phone   VARCHAR(20),
      actor_label   VARCHAR(80),
      action        VARCHAR(100) NOT NULL,
      target_type   VARCHAR(40),
      target_id     VARCHAR(80),
      order_ref     VARCHAR(40),
      source        VARCHAR(80),
      success       BOOLEAN NOT NULL DEFAULT TRUE,
      message       TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  tableReady = true;
}

/**
 * @param {object} row
 * @param {string} row.action — e.g. FORCE_RELEASE, SUSPEND_SHOP, REFUND_BUYER
 */
export async function writeAdminLog(row = {}) {
  const action = String(row.action || "UNKNOWN").slice(0, 100);
  const payload = {
    actorPhone: row.actorPhone || row.actor_phone || null,
    actorLabel: row.actorLabel || row.actor_label || null,
    action,
    targetType: row.targetType || row.target_type || null,
    targetId: row.targetId != null ? String(row.targetId).slice(0, 80) : null,
    orderRef: row.orderRef || row.order_ref || null,
    source: row.source || "boss-intercept",
    success: row.success !== false,
    message: row.message != null ? String(row.message).slice(0, 2000) : null,
    metadata: row.metadata || row.meta || {},
  };

  // Mirror into the shared audit trail for order-linked actions
  if (payload.orderRef || /FORCE_RELEASE|REFUND|PAUSE_ESCROW|SPLIT/i.test(action)) {
    void writeAuditLog({
      orderRef: payload.orderRef,
      actorPhone: payload.actorPhone,
      actorRole: "BOSS",
      action,
      source: payload.source,
      metadata: {
        ...payload.metadata,
        actorLabel: payload.actorLabel,
        success: payload.success,
        targetType: payload.targetType,
        targetId: payload.targetId,
      },
    });
  }

  if (!isDbEnabled()) return { ok: false, skipped: true };
  try {
    await ensureAdminLogsTable();
    await query(
      `INSERT INTO admin_logs (
         actor_phone, actor_label, action, target_type, target_id,
         order_ref, source, success, message, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        payload.actorPhone,
        payload.actorLabel,
        payload.action,
        payload.targetType,
        payload.targetId,
        payload.orderRef,
        payload.source,
        payload.success,
        payload.message,
        JSON.stringify(payload.metadata),
      ]
    );
    return { ok: true };
  } catch (err) {
    console.warn("[admin-logs] write skipped:", err.message);
    return { ok: false, error: err.message };
  }
}

/** Recent Boss / admin actions for the finances / command desks. */
export async function listAdminLogs({ limit = 40, action = null } = {}) {
  if (!isDbEnabled()) return { ok: false, logs: [], error: "database_not_configured" };
  try {
    await ensureAdminLogsTable();
    const act = action ? String(action).toUpperCase() : null;
    const { rows } = await query(
      `SELECT * FROM admin_logs
        WHERE ($1::text IS NULL OR UPPER(action) = $1)
        ORDER BY created_at DESC
        LIMIT $2`,
      [act, Math.min(Math.max(Number(limit) || 40, 1), 200)]
    );
    return {
      ok: true,
      logs: rows.map((r) => ({
        id: Number(r.id),
        actorPhone: r.actor_phone,
        actorLabel: r.actor_label,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        orderRef: r.order_ref,
        source: r.source,
        success: Boolean(r.success),
        message: r.message,
        metadata: r.metadata || {},
        createdAt: r.created_at,
      })),
    };
  } catch (err) {
    return { ok: false, logs: [], error: err.message };
  }
}
