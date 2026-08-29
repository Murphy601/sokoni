/**
 * Append-only audit log for disputes / payout reviews.
 * Fail-soft when Postgres is offline.
 */
import { isDbEnabled, query } from "../db/pool.js";

let tableReady = false;

async function ensureAuditTable() {
  if (tableReady || !isDbEnabled()) return;
  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id            BIGSERIAL PRIMARY KEY,
      order_ref     VARCHAR(40),
      dispatch_id   BIGINT,
      rider_id      INT,
      actor_phone   VARCHAR(20),
      actor_role    VARCHAR(20),
      action        VARCHAR(100) NOT NULL,
      from_status   VARCHAR(40),
      to_status     VARCHAR(40),
      from_custody  VARCHAR(40),
      to_custody    VARCHAR(40),
      source        VARCHAR(80),
      metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  tableReady = true;
}

/**
 * @param {object} row
 */
export async function writeAuditLog(row = {}) {
  if (!isDbEnabled()) return { ok: false, skipped: true };
  try {
    await ensureAuditTable();
    await query(
      `INSERT INTO audit_logs (
         order_ref, dispatch_id, rider_id, actor_phone, actor_role,
         action, from_status, to_status, from_custody, to_custody, source, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        row.orderRef || row.order_ref || null,
        row.dispatchId != null ? Number(row.dispatchId) : null,
        row.riderId != null ? Number(row.riderId) : null,
        row.actorPhone || row.actor_phone || null,
        row.actorRole || row.actor_role || null,
        String(row.action || "UNKNOWN").slice(0, 100),
        row.fromStatus || row.from_status || null,
        row.toStatus || row.to_status || null,
        row.fromCustody || row.from_custody || null,
        row.toCustody || row.to_custody || null,
        row.source || null,
        JSON.stringify(row.metadata || row.meta || {}),
      ]
    );
    return { ok: true };
  } catch (err) {
    console.warn("[audit] write skipped:", err.message);
    return { ok: false, error: err.message };
  }
}
